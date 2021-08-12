import axios from 'axios';
import { firestore } from 'firebase-admin';

export enum Level {
  OFF = 0,
  ERROR = 1,
  INFO = 2,
  DEBUG = 3,
}

const colors = {
  Reset: "\x1b[0m",
  Bright: "\x1b[1m",
  Dim: "\x1b[2m",
  Underscore: "\x1b[4m",
  Blink: "\x1b[5m",
  Reverse: "\x1b[7m",
  Hidden: "\x1b[8m",

  FgBlack: "\x1b[30m",
  FgRed: "\x1b[31m",
  FgGreen: "\x1b[32m",
  FgYellow: "\x1b[33m",
  FgBlue: "\x1b[34m",
  FgMagenta: "\x1b[35m",
  FgCyan: "\x1b[36m",
  FgWhite: "\x1b[37m",

  BgBlack: "\x1b[40m",
  BgRed: "\x1b[41m",
  BgGreen: "\x1b[42m",
  BgYellow: "\x1b[43m",
  BgBlue: "\x1b[44m",
  BgMagenta: "\x1b[45m",
  BgCyan: "\x1b[46m",
  BgWhite: "\x1b[47m",
}

/**
 * Logs messages to firestore.
 */
export default class Logger {
  protected emulator: boolean;
  protected projectId: string;
  protected cloudFunctionsURL: string;

  /**
   * Constructor
   *
   * @param consoleLevel
   * @param remoteLevel
   * @param contextId
   * @param clubId
   * @param source
   */
  constructor(
    protected contextId: string,
    protected clubId: string,
    protected source: string,
    protected consoleLevel: Level = Level.DEBUG,
    protected remoteLevel: Level = Level.INFO,
  ) {
    this.emulator = process.env.FUNCTIONS_EMULATOR === 'true';
    this.projectId = process.env.GCLOUD_PROJECT;
    const cloudURL: string = `https://us-central1-${this.projectId}.cloudfunctions.net`;
    const emulatorURL: string = `localhost:5001/${this.projectId}/us-central1/`;
    this.cloudFunctionsURL = this.emulator ? emulatorURL : cloudURL;
  }

  /**
   * @param contextId
   */
  public setContextId = (contextId: string) => {
    this.contextId = contextId;
  };

  /**
   * @param clubId
   */
  public setClubId = (clubId: string) => {
    this.clubId = clubId;
  };

  /**
   * @param source
   */
  public setSource = (source: string) => {
    this.source = source;
  };

  /**
   * @param message
   * @param object
   */
  debug = (message: unknown, object?: unknown): string => {
    return this.log(Level.DEBUG, message, object);
  }

  /**
   * @param message
   * @param object
   */
  info = (message: unknown, object?: unknown): string => {
    return this.log(Level.INFO, message, object);
  };

  /**
   * @param message
   * @param object
   */
  error = (message: unknown, object?: unknown): string => {
    return this.log(Level.ERROR, message, object);
  };

  /**
   * @param level
   * @param message
   * @param object
   */
  log = (level: number, message: unknown, object?: unknown): string => {
    let consoleMessage: string = this.emulator ? (this.source + ': ') : '';
    consoleMessage += String(level) + ':';
    if (!!this.clubId) {
      consoleMessage += this.clubId + ':';
    }
    if (!!this.contextId) {
      consoleMessage += this.contextId + ': ';
    }

    let messageBody: string = '';
    if (typeof message !== 'string') {
      //stringify m1
      messageBody += JSON.stringify(message);
    } else {
      messageBody += message;
    }
    if (object !== null && object !== undefined) {
      //stringify and append m2
      messageBody += ': ';
      if (typeof object !== 'string') {
        messageBody += JSON.stringify(object);
      } else {
        messageBody += object;
      }
    }

    if (level <= this.consoleLevel) {
      if (this.emulator) {
        console.log(colors.FgMagenta + '%s' + colors.Reset + '%s', consoleMessage, messageBody);
      } else {
        console.log(consoleMessage + messageBody);
      }
    }

    if (!this.emulator && (level <= this.remoteLevel)) {
      try {
        axios({
          method: 'POST',
          url: `${this.cloudFunctionsURL}/simpleLogger`,
          data: {
            data: {
              clubId: this.clubId,
              messageId: firestore.Timestamp.fromDate(new Date()),
              records: {
                contextId: this.contextId,
                message: messageBody,
                level: level,
                raw: {
                  message: message,
                  object: object,
                },
                config: {
                  consoleLevel: this.consoleLevel,
                  remoteLevel: this.remoteLevel
                }
              },
              source: this.source
            }
          }
        });
      } catch (e) {
        console.log('error sending message to remote logging service');
        console.log(e?.toJSON()?.message);
      }
    }

    return consoleMessage + messageBody;
  }
}
