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
 * Creates a Wss object for the incoming request
 *
 * @param data
 * @param headers
 * @param manifest
 * @param args
 */
export const createWssFromRequest = (
  data: any,
  headers: NodeJS.Dict<string>,
  manifest: Manifest,
  args: WssMiddlewareArgs,
  ): Wss => {
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
  Object.keys(headers).forEach((key) => {
    if (key.indexOf(prefix) === 0) {
      const [k, v] = headers[key].split(':', 2);
      attributes[k] = v;
    }
  });

  const logger = new Logger(
    manifest.name,
    attributes.sessionId || 'noContext',
    attributes.clubId || 'noClub',
    args.consoleLogLevel,
    args.remoteLogLevel,
  );

  return {
    event,
    logger,
    manifest,
    attributes,
    dispatch: (e: IEvent) => {},
    pluginVersion: data[JsonPluginVersion],
  };
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
    let data = req.body;
    if (typeof req.body !== 'object') {
      try {
        data = JSON.parse(req.body);
      } catch (error) {
        return next(error);
      }
    }

    // Generate the wss object.
    const headers = {};
    Object.keys(req.headers).forEach((key) => {
      headers[key] = Array.isArray(req.headers[key]) ? req.headers[key][0] : req.headers[key];
    })
    req.wss = createWssFromRequest(data, headers, manifest, args);

    // Checks if this request is for an event endpoint by looking for the HeaderWssEvent
    // header. Pass through to the endpoint function when the request isn't for an event endpoint.
    if (!req.header(HeaderWssEvent) || res.headersSent) {
      return next();
    }

    // Check for required message id for event endpoints.
    const messageId = req.header(HeaderWssEvent);
    if (data[JsonEventKey] === undefined) {
      const err = new Error(`Body ${JsonEventKey} not found in request.`);
      req.wss.logger.error(err.message);
      return next(err);
    }

    // Check if the request is for the plugin manifest.
    if (data[JsonEventKey].name === ManifestEventName) {
      req.wss.logger.debug('Returning', manifest);
      res.header(HeaderWssEvent, messageId);
      res.header(HeaderWssVersion, manifest.version);
      return res.json({
        [JsonEventKey]: manifest,
      });
    }

    // Calls the plugin endpoint function.
    next();

    // Returns the event to the event dispatcher.
    if (!res.headersSent) {
      const e = req.wss.event();
      req.wss.logger.debug('Returning', e);
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
    // Check if this was a request for an event endpoint because the error handler
    // only catches errors for event handlers.
    if (!req.header(HeaderWssEvent) || res.headersSent) {
      return next(err);
    }

    // The error will get passed back to the event dispatcher in the event
    // errors array.
    const e = req.wss.event();
    e.errors.push(err.stack);
    if (req.wss) {
      req.wss.logger.error(err.stack);
    }

    // Send the event with errors back to the event dispatcher.
    res.status(500);
    res.setHeader(HeaderWssEvent, req.header(HeaderWssEvent));
    res.setHeader(HeaderWssVersion, req.wss.manifest.version);
    res.json({
      [JsonEventKey]: e,
    });

    // We still want Express to throw the error.
    next(err);
  };
}

/**
 * Pubsub middleware to encode and decode wss events and manifests.
 *
 * @param manifest
 * @param args
 */
export const wssPubSub = (
  manifest: Manifest,
  args: WssMiddlewareArgs = {
    consoleLogLevel: Level.DEBUG,
    remoteLogLevel: Level.INFO,
  },
) => {
  return (func: (message: Message, context: EventContext, wss: Wss) => any) => {
    return (message: Message, context: EventContext): Promise<string> => {
      const { json } = message;

      // Generate the wss object.
      const wss = createWssFromRequest(json, message.attributes, manifest, args);

      // Check if the pubsub is being called with an event. If not pass through without doing
      // any more wss processing.
      wss.logger.debug('Received', json);
      if (message.attributes[HeaderWssEvent] === undefined) {
        return func(message, context, wss);
      }

      // Initialize publishing the plugin response to the event dispatcher return topic.
      if (!message.attributes[JsonReturnTopic]) {
        wss.logger.error(`Request missing ${JsonReturnTopic}`);
        throw new Error(`Request missing ${JsonReturnTopic}`);
      }
      const messageId = message.attributes[HeaderWssEvent];
      const [apiEndpoint, projectId, topic] = message.attributes[JsonReturnTopic].split('/');
      const pubSub = new PubSub({
        projectId,
        apiEndpoint,
      });

      /**
       * Sends the given values back to the event dispatcher
       *
       * @param values
       */
      const publish = (values: any): Promise<string> => {
        wss.logger.debug(`Returning`, manifest);
        return pubSub.topic(topic).publishJSON({
          [JsonEventKey]: values,
        }, {
          [HeaderWssEvent]: messageId,
          [HeaderWssVersion]: manifest.version,
        });
      }

      // Check if this is a request for the plugin manifest. Send the manifest back to the
      // event dispatcher if so.
      if (json[JsonEventKey].name === ManifestEventName) {
        try {
          return publish(manifest);
        } catch (error) {
          wss.logger.error(error);
          return;
        }
      }

      // Call the plugin pubsub function with the wss object.
      const e = wss.event();
      try {
        func(message, context, wss);
      } catch (error) {
        e.errors.push(error.toString());
        wss.logger.error(error);
      }

      // Publish the response back to the event dispatcher.
      try {
        return publish(e);
      } catch (error) {
        wss.logger.error(error);
      }
    };
  }
};
