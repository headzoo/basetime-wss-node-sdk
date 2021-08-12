/**
 * Represents values sent to event handlers.
 */
export interface IEvent {
  /**
   * The name of the event
   */
  name: string;

  /**
   * Errors which occurred while the event was dispatching
   */
  errors: string[];

  /**
   * Describes whether propagation of an event should continue
   */
  isPropagationStopped: boolean;

  /**
   * Called to stop propagation of the event
   */
  stopPropagation: () => void;
}

/**
 * Base event class.
 */
export class Event implements IEvent {
  /**
   * @inheritdoc
   */
  public errors: string[] = [];

  /**
   * @inheritdoc
   */
  public isPropagationStopped = false;

  /**
   * @param name The name of the event
   */
  constructor(public name: string) {}

  /**
   * @inheritdoc
   */
  stopPropagation = () => {
    this.isPropagationStopped = true;
  };
}
