"""Signal-aware Uvicorn entrypoint with one total shutdown deadline."""
import os
import threading

import uvicorn


class GracefulServer(uvicorn.Server):
    def __init__(self, config, lifecycle_getter, shutdown_seconds=35):
        super().__init__(config)
        self.lifecycle_getter = lifecycle_getter
        self.shutdown_seconds = shutdown_seconds
        self._draining = False
        self._watchdog = None

    def handle_exit(self, sig, frame):
        if self._draining:
            return  # repeated signals cannot bypass the admitted-work drain
        self._draining = True
        state = self.lifecycle_getter()
        if state is not None:
            state.begin_draining()
        self._watchdog = threading.Timer(self.shutdown_seconds, lambda: os._exit(1))
        self._watchdog.daemon = True
        self._watchdog.start()
        # Uvicorn's base handler records signals to re-raise after cleanup. This
        # executable owns the final 0/1 result (including timeouts), so request
        # graceful exit without re-raising SIGTERM over that verified result.
        self.should_exit = True

    def run(self, *args, **kwargs):
        try:
            return super().run(*args, **kwargs)
        finally:
            if self._watchdog:
                self._watchdog.cancel()


def main():
    import main as application
    seconds = min(40, max(1, float(os.getenv('SHUTDOWN_TIMEOUT_SECONDS', '35'))))
    http_deadline = seconds - min(5, seconds / 5)
    server = GracefulServer(uvicorn.Config(application.app, host='0.0.0.0', port=int(os.getenv('PORT', '8000')),
        timeout_graceful_shutdown=http_deadline), lambda: application.lifecycle_state.current, seconds)
    server.run()
    state = application.lifecycle_state.current
    if state is not None and (state.forced or state.failed):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
