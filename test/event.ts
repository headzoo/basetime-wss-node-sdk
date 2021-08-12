import { expect } from 'chai';
import { Event } from '../src/event';

describe('Event', () => {
  describe('#stopPropagation()', () => {
    it('should return false', () => {
      const e = new Event('payments.QUERY');
      expect(e.isPropagationStopped).to.equal(false);
    });

    it('should return true', () => {
      const e = new Event('payments.QUERY');
      e.stopPropagation();
      expect(e.isPropagationStopped).to.equal(true);
    });
  });
});
