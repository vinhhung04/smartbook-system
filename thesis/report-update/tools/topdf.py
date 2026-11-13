import sys, os, win32com.client as w
src, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
app = w.DynamicDispatch('Word.Application') if hasattr(w, 'DynamicDispatch') else w.dynamic.Dispatch('Word.Application')
app.Visible = False
app.DisplayAlerts = 0
opt = app.Options
prev = (opt.UpdateFieldsAtPrint, opt.UpdateLinksAtPrint)
try:
    opt.UpdateFieldsAtPrint = False
    opt.UpdateLinksAtPrint = False
    doc = app.Documents.Open(src, False, True, False)
    n = doc.ComputeStatistics(2)
    doc.ExportAsFixedFormat(out, 17, False, 0, 0, 0, 0, 0, True, True, 1, True, True, False)
    doc.Close(0)
    print('pages', n)
finally:
    opt.UpdateFieldsAtPrint, opt.UpdateLinksAtPrint = prev
    app.Quit()
