import { IEvent } from './event';

/**
 * Describes a event handler properties and subscriptions.
 */
export interface Manifest {
  manifestVersion: string;
  name: string;
  subsystem: string;
  description: string;
  version: string;
  subscriptions: Record<string, string | URL | ((e: IEvent) => Promise<void>)>;
}

/**
 * Should be used by event handlers as a response to the system.MANIFEST event.
 */
export interface ManifestEvent extends IEvent {
  manifestVersion: string;
  name: string;
  subsystem: string;
  description: string;
  version: string;
  subscriptions: Record<string, string | URL | ((e: IEvent) => Promise<void>)>;
}

export const ManifestEventName = 'system.MANIFEST';
