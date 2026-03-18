import { useState } from "react";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion, AnimatePresence } from "motion/react";
import { Upload, Camera, Loader2, Check, X, Edit, AlertCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";

const mockResults = [
  { id: 1, title: "Clean Code", author: "Robert C. Martin", publisher: "Prentice Hall", isbn: "978-0132350884", confidence: 0.96, status: "pending" },
  { id: 2, title: "Design Patterns", author: "Gang of Four", publisher: "Addison-Wesley", isbn: "978-0201633610", confidence: 0.89, status: "pending" },
  { id: 3, title: "Unknown Title", author: "Unknown", publisher: "Unknown", isbn: "978-XXXXXXXXXX", confidence: 0.32, status: "pending" },
];

export function AIImportPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [fileCount, setFileCount] = useState(0);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    processFiles(files);
  };

  const processFiles = (files) => {
    const imageFiles = files.filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      toast.error("Please upload image files");
      return;
    }

    setFileCount(imageFiles.length);
    setIsProcessing(true);
    setProgress(0);

    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(interval);
          setIsProcessing(false);
          setResults(mockResults.map(r => ({ ...r, status: "completed" })));
          toast.success(`Processed ${imageFiles.length} images with AI`);
          return 100;
        }
        return p + Math.random() * 30;
      });
    }, 300);
  };

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-cyan-100 to-blue-50 flex items-center justify-center border border-cyan-200/40">
            <Sparkles className="w-5 h-5 text-cyan-600" />
          </div>
          <div>
            <h1 className="tracking-[-0.02em]">AI-Powered Import</h1>
            <p className="text-[12px] text-slate-400 mt-0.5">Extract book metadata from images using AI</p>
          </div>
        </div>
      </FadeItem>

      {results.length === 0 ? (
        <>
          {/* Upload Zone */}
          <FadeItem>
            <motion.div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
              className={`relative border-2 border-dashed rounded-[16px] p-8 transition-all cursor-pointer ${isDragging ? "border-cyan-500 bg-cyan-50/30" : "border-slate-300 bg-slate-50/30 hover:border-slate-400"}`}
              whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
              <input type="file" multiple accept="image/*" onChange={e => processFiles(Array.from(e.target.files))} className="absolute inset-0 opacity-0 cursor-pointer" />
              <div className="flex flex-col items-center justify-center py-8">
                <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 2, repeat: Infinity }} className="mb-4">
                  <Upload className="w-12 h-12 text-cyan-500" />
                </motion.div>
                <h3 className="text-[14px] mb-1" style={{ fontWeight: 650 }}>Drag and drop your images here</h3>
                <p className="text-[12px] text-slate-500 mb-4">or click to select files from your computer</p>
                <button className="px-4 py-2 rounded-[10px] bg-gradient-to-r from-cyan-600 to-blue-600 text-white text-[12px] hover:shadow-lg transition-all" style={{ fontWeight: 550 }}>
                  <Camera className="w-3.5 h-3.5 inline mr-2" /> Choose Files
                </button>
                <p className="text-[11px] text-slate-400 mt-3">Supported formats: JPG, PNG, WebP</p>
              </div>
            </motion.div>
          </FadeItem>

          {/* Processing State */}
          <AnimatePresence>
            {isProcessing && (
              <FadeItem>
                <div className="bg-white rounded-[16px] border border-white/80 p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
                  <div className="flex items-center gap-3 mb-4">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
                      <Loader2 className="w-5 h-5 text-cyan-600" />
                    </motion.div>
                    <h3 className="text-[14px]" style={{ fontWeight: 650 }}>Processing images with AI...</h3>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.3 }}
                      className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full" />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] text-slate-500">Extracting metadata and verifying data...</p>
                    <p className="text-[12px] text-cyan-600" style={{ fontWeight: 550 }}>{Math.round(progress)}%</p>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">{fileCount} image{fileCount !== 1 ? "s" : ""} processing</p>
                </div>
              </FadeItem>
            )}
          </AnimatePresence>
        </>
      ) : (
        <>
          {/* Results */}
          <FadeItem>
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              <span className="text-[13px] text-emerald-700" style={{ fontWeight: 550 }}>Processing complete</span>
            </div>
          </FadeItem>

          <div className="space-y-3">
            {results.map((result, i) => {
              const confColor = result.confidence > 0.8 ? "text-emerald-600" : result.confidence > 0.5 ? "text-amber-600" : "text-rose-600";
              return (
                <FadeItem key={result.id}>
                  <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}
                    className="bg-white rounded-[12px] border border-white/80 p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
                    <div className="flex items-start gap-4 mb-3">
                      <div className="relative w-16 h-20 rounded-[8px] bg-gradient-to-br from-slate-100 to-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                        <div className="relative flex items-center justify-center">
                          <svg viewBox="0 0 40 40" className="w-12 h-12">
                            <circle cx="20" cy="20" r="18" fill="none" stroke="#e2e8f0" strokeWidth="2" />
                            <motion.circle cx="20" cy="20" r="18" fill="none" stroke={result.confidence > 0.8 ? "#10b981" : result.confidence > 0.5 ? "#f59e0b" : "#ef4444"}
                              strokeWidth="2" strokeLinecap="round" strokeDasharray={`${result.confidence * 113.1} 113.1`}
                              initial={{ strokeDasharray: "0 113.1" }} animate={{ strokeDasharray: `${result.confidence * 113.1} 113.1` }}
                              transition={{ duration: 0.8, ease: "easeOut", delay: i * 0.1 + 0.3 }} />
                          </svg>
                          <span className="absolute text-[10px] font-mono" style={{ fontWeight: 700 }}>{Math.round(result.confidence * 100)}</span>
                        </div>
                      </div>
                      <div className="flex-1">
                        <h4 className="text-[13px]" style={{ fontWeight: 650 }}>{result.title}</h4>
                        <p className="text-[12px] text-slate-500 mt-0.5">{result.author}</p>
                        <div className="mt-2 space-y-1">
                          <p className="text-[11px] text-slate-500"><span style={{ fontWeight: 550 }}>Publisher:</span> {result.publisher}</p>
                          <p className="text-[11px] font-mono text-slate-500"><span style={{ fontWeight: 550 }} className="block mb-0.5">ISBN:</span> {result.isbn}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[8px] border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] hover:bg-emerald-100 transition-all" style={{ fontWeight: 550 }}>
                          <Check className="w-3.5 h-3.5" /> Accept
                        </button>
                        <button className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[8px] border border-slate-200 bg-white text-slate-700 text-[11px] hover:bg-slate-50 transition-all" style={{ fontWeight: 550 }}>
                          <Edit className="w-3.5 h-3.5" /> Edit
                        </button>
                        <button className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[8px] border border-rose-200 bg-rose-50 text-rose-700 text-[11px] hover:bg-rose-100 transition-all" style={{ fontWeight: 550 }}>
                          <X className="w-3.5 h-3.5" /> Reject
                        </button>
                      </div>
                    </div>

                    {result.confidence < 0.8 && (
                      <motion.div className="bg-amber-50 border border-amber-200/60 rounded-[8px] p-2 flex items-start gap-2">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-amber-700">Low confidence match. Please verify manually.</p>
                      </motion.div>
                    )}
                  </motion.div>
                </FadeItem>
              );
            })}
          </div>

          <FadeItem>
            <div className="flex items-center gap-3">
              <button onClick={() => { setResults([]); toast.info("Ready for new upload"); }} className="flex-1 px-4 py-2.5 rounded-[10px] border border-slate-200 bg-white text-slate-700 text-[13px] hover:bg-slate-50 transition-all" style={{ fontWeight: 550 }}>
                Upload More
              </button>
              <button className="flex-1 px-4 py-2.5 rounded-[10px] bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[13px] shadow-md shadow-emerald-500/15 hover:shadow-lg transition-all" style={{ fontWeight: 550 }}>
                Import Selected ({results.filter(r => r.status === "completed").length})
              </button>
            </div>
          </FadeItem>
        </>
      )}
    </PageWrapper>
  );
}
