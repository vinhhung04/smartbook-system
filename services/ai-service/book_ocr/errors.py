"""One error type for the whole scan pipeline; routes_book_ocr turns it into
`{"message", "code"}` JSON (the shape the web client's getApiErrorMessage /
getApiErrorCode read), so every failure reaches the UI as readable text."""


class BookOcrError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
