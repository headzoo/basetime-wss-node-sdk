import { Message } from 'firebase-functions/lib/providers/pubsub';
import { EventContext } from 'firebase-functions';
import { PubSub } from '@google-cloud/pubsub';
import { NextFunction, Request, Response } from 'express';
import { IEvent } from './event';
import { Manifest, ManifestEventName } from './manifest';
import Logger, { Level } from './logger';
import {
  HeaderWssAttrib,
  HeaderWssEvent,
  HeaderWssVersion,
  JsonEventKey,
  JsonReturnTopic,
  JsonPluginVersion,
} from './http';

declare global {
  namespace Express {
    export interface Request {
      wss: Wss
    }
  }
}

export interface Wss {
  event: <T extends IEvent>() => T;
  logger: Logger;
  dispatch: (e: IEvent) => void;
  attributes: Record<string, string>;
  manifest: Manifest;
  pluginVersion: string;
}

export interface WssMiddlewareArgs {
  consoleLogLevel: Level,
  remoteLogLevel: Level,
}

/**
 * Express middleware to encode and decode wss events and manifests.
 */
export const wssMiddleware = (
  manifest: Manifest,
  args: WssMiddlewareArgs = {
    consoleLogLevel: Level.DEBUG,
    remoteLogLevel: Level.INFO,
  },
) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    const { consoleLogLevel, remoteLogLevel } = args;

    let data = req.body;
    if (typeof req.body !== 'object') {
      try {
        data = JSON.parse(req.body);
      } catch (error) {
        return next(error);
      }
    }

    /**
     * Returns the event which was dispatched to the endpoint.
     */
    const event = <T extends IEvent>(): T => {
      if (data[JsonEventKey] === undefined) {
        throw new Error('This endpoint does not return an event.');
      }

      const e = { ...data[JsonEventKey] } as T;

      /**
       * Stops event propagation.
       */
      e.stopPropagation = () => {
        e.isPropagationStopped = true;
      };

      return e;
    }

    // Parses attribute headers, which are in the format "x-wss-attrib-sessionid: sessionId:12345"
    const prefix = HeaderWssAttrib.toLowerCase();
    const attributes: Record<string, string> = {};
    Object.keys(req.headers).forEach((key) => {
      if (key.indexOf(prefix) === 0) {
        const [k, v] = req.header(key).split(':', 2);
        attributes[k] = v;
      }
    });

    const logger = new Logger(
      manifest.name,
      attributes.sessionId || 'noContext',
      attributes.clubId || 'noClub',
      consoleLogLevel,
      remoteLogLevel,
    );

    req.wss = {
      event,
      logger,
      attributes,
      dispatch: (e: IEvent) => {},
      manifest,
      pluginVersion: data[JsonPluginVersion],
    };

    if (!req.header(HeaderWssEvent) || res.headersSent) {
      return next();
    }

    const messageId = req.header(HeaderWssEvent);
    if (data[JsonEventKey] === undefined) {
      logger.error(`Body ${JsonEventKey} not found in request.`);
      return next();
    }

    if (data[JsonEventKey].name === ManifestEventName) {
      logger.debug('Returning', manifest);
      res.header(HeaderWssEvent, messageId);
      res.header(HeaderWssVersion, manifest.version);
      return res.json({
        [JsonEventKey]: manifest,
      });
    }

    next();

    if (!res.headersSent) {
      const e = event();
      logger.debug('Returning', e);
      res.header(HeaderWssEvent, messageId);
      res.header(HeaderWssVersion, manifest.version);
      return res.json({
        [JsonEventKey]: e,
      });
    }
  };
};

/**
 * Express middleware that returns errors back to the event dispatcher.
 */
export const wssErrorMiddleware = () => {
  return async (err: Error, req: Request, res: Response, next: NextFunction): Promise<any> => {
    if (!req.header(HeaderWssEvent) || res.headersSent) {
      return next(err);
    }

    const e = req.wss.event();
    e.errors.push(err.stack);
    if (req.wss) {
      req.wss.logger.error(err.stack);
    }

    res.status(500);
    res.setHeader(HeaderWssEvent, req.header(HeaderWssEvent));
    res.setHeader(HeaderWssVersion, req.wss.manifest.version);
    res.json({
      [JsonEventKey]: e,
    });
    next(err);
  };
}

/**
 * @param manifest
 * @param consoleLogLevel
 * @param remoteLogLevel
 */
export const wssPubSub = (
  manifest: Manifest,
  consoleLogLevel = Level.DEBUG,
  remoteLogLevel = Level.INFO,
) => {
  return (func: (message: Message, context: EventContext, wss: Wss) => any) => {
    return (message: Message, context: EventContext): Promise<string> => {
      const { json } = message;

      /**
       *
       */
      const event = <T extends IEvent>(): T => {
        if (json && json[JsonEventKey] === undefined) {
          throw new Error('This trigger does not return an event.');
        }
        const e = json[JsonEventKey] as T;
        e.stopPropagation = () => {
          e.isPropagationStopped = true;
        };

        return e;
      };

      // Parses special WSS only attributes, which are in the format "X-Wss-Attrib-sessionKd: 12345"
      const attributes: Record<string, string> = {};
      Object.keys(message.attributes).forEach((key) => {
        if (key.indexOf(HeaderWssAttrib) === 0) {
          const k = key.split('-').pop();
          attributes[k] = message.attributes[key];
        }
      });

      const logger = new Logger(
        manifest.name,
        attributes.sessionId || 'noContext',
        attributes.clubId || 'noClub',
        consoleLogLevel,
        remoteLogLevel,
      );

      const wss = {
        event,
        logger,
        attributes,
        dispatch: (e: IEvent) => {},
        manifest,
        pluginVersion: json[JsonPluginVersion],
      };

      logger.debug('Received', json);
      if (message.attributes[HeaderWssEvent] === undefined) {
        return func(message, context, wss);
      }

      if (!message.attributes[JsonReturnTopic]) {
        logger.error(`Request missing ${JsonReturnTopic}`);
        throw new Error(`Request missing ${JsonReturnTopic}`);
      }

      const messageId = message.attributes[HeaderWssEvent];
      const [apiEndpoint, projectId, topic] = message.attributes[JsonReturnTopic].split('/');
      const pubSub = new PubSub({
        projectId,
        apiEndpoint,
      });

      /**
       * @param values
       */
      const publish = (values: any): Promise<string> => {
        logger.debug(`Returning`, manifest);
        return pubSub.topic(topic).publishJSON({
          [JsonEventKey]: values,
        }, {
          [HeaderWssEvent]: messageId,
          [HeaderWssVersion]: manifest.version,
        });
      }

      if (json[JsonEventKey].name === ManifestEventName) {
        try {
          return publish(manifest);
        } catch (error) {
          logger.error(error);
          return;
        }
      }

      const e = event();
      try {
        func(message, context, wss);
      } catch (error) {
        e.errors.push(error.toString());
        logger.error(error);
      }

      try {
        return publish(e);
      } catch (error) {
        logger.error(error);
      }
    };
  }
};
