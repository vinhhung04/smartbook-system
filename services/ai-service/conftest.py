import os

# Keep the suite offline: every book source of the two-round ISBN search
# (main._book_providers) is switched off unless a test injects its own fakes.
# Live checks of the real sites run separately (eval/live_book_sources.py).
os.environ["ISBN_PERSISTENT_CACHE"] = "false"
os.environ["ENABLE_BOOKSTORE_CODE_INDEX"] = "false"
os.environ["ISBN_DISABLED_SOURCES"] = "aiWebSearch,ipm,kimDong,azVietnam,omegaPlus,tanViet,alphaBooks,catalog,fahasa,googleBooks,openLibrary,dinhTi,tiki,nhanam,thaiHa,vanLang,webSearch"
