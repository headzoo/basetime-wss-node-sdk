import { IEvent } from './event';

/**
 * Both local and remote event handlers.
 */
export type AnyEventHandler = IEventHandler | URL;

/**
 * Local event handler callback.
 */
export type EventHandlerCallback = (e: IEvent) => Promise<void>;

/**
 * Represents a locally installed event handler.
 */
export interface IEventHandler {
  /**
   * Returns the name of the event handler
   */
  getName(): string;

  /**
   * Returns the subsystem the event handler runs under
   */
  getSubsystem(): string;

  /**
   * Returns a handler description
   */
  getDescription(): string;

  /**
   * Returns the handler version
   */
  getVersion(): string;

  /**
   * Returns callbacks for the events the handler subscribes to
   */
  getSubscriptions(): Record<string, EventHandlerCallback>;
}

/**
 * Parent class for local event handlers.
 */
export abstract class EventHandler implements IEventHandler {
  /**
   * @inheritDoc
   */
  abstract getDescription(): string;

  /**
   * @inheritDoc
   */
  abstract getName(): string;

  /**
   * @inheritDoc
   */
  abstract getSubsystem(): string;

  /**
   * @inheritDoc
   */
  abstract getVersion(): string;

  /**
   * @inheritDoc
   */
  getSubscriptions = (): Record<string, EventHandlerCallback> => {
    return {};
  };
}
