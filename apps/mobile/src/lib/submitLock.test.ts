import { createSubmitLock } from './submitLock';

describe('createSubmitLock', () => {
  it('drops a second call while the first is in flight', async () => {
    const lock = createSubmitLock();
    let release!: () => void;
    const work = jest.fn(() => new Promise<string>((resolve) => { release = () => resolve('done'); }));

    const first = lock.run(work);
    const second = lock.run(work);
    expect(lock.busy).toBe(true);
    await expect(second).resolves.toBeUndefined();
    release();
    await expect(first).resolves.toBe('done');
    expect(work).toHaveBeenCalledTimes(1);
    expect(lock.busy).toBe(false);
  });

  it('releases after a failure so the user can try again', async () => {
    const lock = createSubmitLock();
    await expect(lock.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(lock.run(async () => 2)).resolves.toBe(2);
  });
});
