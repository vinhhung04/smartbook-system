// src/components/AIChatbot.jsx
// Chatbot nổi cố định ở góc dưới phải — luôn hiển thị trên mọi trang

import { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Sparkles } from 'lucide-react';

// =====================  MOCK CONVERSATION  =====================
const INITIAL_MESSAGES = [
  {
    id: 1,
    role: 'bot',
    text: 'Xin chào! Tôi là trợ lý AI của SmartBook. Bạn cần tôi tra cứu tồn kho, đề xuất nhập hàng hay phân tích gì không? 😊',
  },
  {
    id: 2,
    role: 'user',
    text: 'Tồn kho sách Đắc Nhân Tâm hiện tại?',
  },
  {
    id: 3,
    role: 'bot',
    text: 'Hiện tại **Đắc Nhân Tâm** còn **15 cuốn** ở Kệ A-1 (bìa cứng) và 4 cuốn ở Kệ D-3 (bìa mềm, cũ). Tốc độ bán đang ở mức cao (~20 cuốn/tuần), bạn nên cân nhắc nhập thêm nhé! 📦',
  },
  {
    id: 4,
    role: 'user',
    text: 'Sách nào đang tồn kho lâu nhất?',
  },
  {
    id: 5,
    role: 'bot',
    text: '3 sách tồn kho lâu nhất hiện tại:\n1. Dune — 34 cuốn (127 ngày)\n2. Nghệ Thuật Tinh Tế… — 58 cuốn (98 ngày)\n3. The Hobbit — 22 cuốn (85 ngày)\nBạn có muốn tôi lập kế hoạch xả hàng không?',
  },
];

// =====================  Helper: render text với **bold** =====================
function MessageText({ text }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <span className="whitespace-pre-line text-sm leading-relaxed">
      {parts.map((part, i) =>
        i % 2 === 1 ? <strong key={i}>{part}</strong> : part
      )}
    </span>
  );
}

// =====================  MAIN COMPONENT  =====================
export default function AIChatbot() {
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [input, setInput]       = useState('');
  const [typing, setTyping]     = useState(false);
  const bottomRef               = useRef(null);

  // Auto-scroll xuống cuối mỗi khi messages thay đổi
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, typing]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const userMsg = { id: Date.now(), role: 'user', text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setTyping(true);

    // Giả lập phản hồi AI sau 1.2 giây
    setTimeout(() => {
      const botMsg = {
        id: Date.now() + 1,
        role: 'bot',
        text: `Tôi đã nhận câu hỏi: "${trimmed}". Tính năng truy vấn thời gian thực sẽ được tích hợp với backend AI trong phiên bản tiếp theo. Hiện tại bạn có thể xem trang **Gợi ý AI** để biết thêm phân tích chi tiết! 🚀`,
      };
      setMessages((prev) => [...prev, botMsg]);
      setTyping(false);
    }, 1200);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      {/* ===== CỬA SỔ CHAT ===== */}
      {open && (
        <div className="w-80 h-[420px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-indigo-600 px-4 py-3 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
                <Bot size={15} className="text-white" />
              </div>
              <div>
                <p className="text-white text-sm font-semibold leading-none">Trợ lý ảo AI</p>
                <p className="text-indigo-200 text-[11px] mt-0.5">SmartBook AI • Trực tuyến</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-white/70 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-slate-50">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'bot' && (
                  <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center mr-2 mt-0.5 flex-shrink-0">
                    <Sparkles size={12} className="text-indigo-600" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-white text-gray-700 shadow-sm border border-gray-100 rounded-bl-sm'
                  }`}
                >
                  <MessageText text={msg.text} />
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {typing && (
              <div className="flex justify-start">
                <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center mr-2 flex-shrink-0">
                  <Sparkles size={12} className="text-indigo-600" />
                </div>
                <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm px-4 py-2.5 flex items-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Footer Input */}
          <div className="px-3 py-3 border-t border-gray-100 bg-white flex items-center gap-2 flex-shrink-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Nhập câu hỏi..."
              className="flex-1 text-sm bg-slate-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="w-9 h-9 flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg transition-colors flex-shrink-0"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ===== NÚT TOGGLE (FLOATING BUTTON) ===== */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-700 shadow-lg flex items-center justify-center text-white transition-all active:scale-95"
        aria-label="Mở chatbot AI"
      >
        {open ? <X size={22} /> : <Bot size={24} />}

        {/* Hiệu ứng ping khi đóng */}
        {!open && (
          <span className="absolute inset-0 rounded-full bg-indigo-500 animate-ping opacity-30" />
        )}
      </button>
    </div>
  );
}
