"use client";

import { useState, useRef, useEffect } from "react";
import { upload } from "@vercel/blob/client";
import {
  Mic, Volume2, VolumeX, Send, Loader2, FileText, X, AlertCircle,
  Phone, FileUp, RefreshCw, ChevronDown,
} from "lucide-react";
import { DEFAULT_POLICY, DEFAULT_POLICY_NAME, DEFAULT_GREETING } from "@/lib/default-policy";

type Message = {
  role: "user" | "assistant";
  content: string;
};

// Web Speech API types - browser-only, may not exist on server.
// We use 'any' deliberately because the Web Speech API isn't well-typed
// in TypeScript's default lib, and this is a non-critical browser feature.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionType = any;
declare global {
  interface Window {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  }
}

export default function HomePage() {
  // Policy state — either text (default + uploaded txt/md) or PDF (uploaded pdf,
  // processed natively by Gemini)
  const [policy, setPolicy] = useState<string>(DEFAULT_POLICY);
  const [policyPdfBase64, setPolicyPdfBase64] = useState<string | null>(null);
  const [policyName, setPolicyName] = useState<string>(DEFAULT_POLICY_NAME);
  const [policyMeta, setPolicyMeta] = useState<{ pages?: number; chars: number; bytes?: number }>({
    chars: DEFAULT_POLICY.length,
  });
  const [usingDefault, setUsingDefault] = useState(true);
  const [showPolicyDrawer, setShowPolicyDrawer] = useState(false);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Voice state
  const [voiceOn, setVoiceOn] = useState(true);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [callStarted, setCallStarted] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);

  // Refs
  const recognitionRef = useRef<SpeechRecognitionType | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Init speech recognition
  useEffect(() => {
    const SR =
      typeof window !== "undefined"
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;
    if (!SR) {
      setVoiceSupported(false);
      return;
    }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-IN";

    rec.onresult = (e: SpeechRecognitionType) => {
      let final = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interimText += t;
      }
      if (interimText) setInterim(interimText);
      if (final) {
        setInterim("");
        sendMessage(final.trim());
      }
    };
    rec.onerror = (e: SpeechRecognitionType) => {
      if (e.error !== "aborted" && e.error !== "no-speech") {
        setError(`Speech recognition: ${e.error}`);
      }
      setListening(false);
      setInterim("");
    };
    rec.onend = () => {
      setListening(false);
    };
    recognitionRef.current = rec;

    return () => {
      try {
        rec.abort();
      } catch {
        // ignore
      }
      if (typeof window !== "undefined") {
        window.speechSynthesis?.cancel();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Speak greeting when call starts
  useEffect(() => {
    if (callStarted && voiceOn && messages.length === 1) {
      speak(messages[0].content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callStarted]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, interim]);

  const speak = (text: string) => {
    if (!voiceOn) return;
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.pitch = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => v.lang === "en-IN" && /female/i.test(v.name)) ||
      voices.find((v) => v.lang === "en-IN") ||
      voices.find((v) => v.lang === "en-GB" && /female/i.test(v.name)) ||
      voices.find((v) => v.lang.startsWith("en") && /female|samantha|karen/i.test(v.name)) ||
      voices.find((v) => v.lang.startsWith("en"));
    if (preferred) u.voice = preferred;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  };

  const stopSpeaking = () => {
    if (typeof window === "undefined") return;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  };

  const toggleListen = () => {
    if (!recognitionRef.current) return;
    if (listening) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      setListening(false);
    } else {
      stopSpeaking();
      setError(null);
      try {
        recognitionRef.current.start();
        setListening(true);
      } catch {
        setError("Could not start microphone. Please check browser permissions.");
      }
    }
  };

  const sendMessage = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || loading) return;

    const newUser: Message = { role: "user", content: text };
    const updated = [...messages, newUser];
    setMessages(updated);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const apiMessages = updated.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Send either policy text (for txt/md/default) or PDF base64 (for uploaded PDF).
      // Gemini parses the PDF natively — no server-side extraction needed.
      const reqBody: Record<string, unknown> = {
        messages: apiMessages,
        policyName,
      };
      if (policyPdfBase64) {
        reqBody.policyPdfBase64 = policyPdfBase64;
      } else {
        reqBody.policy = policy;
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }

      const reply = (data.reply || "").trim();
      setMessages([...updated, { role: "assistant", content: reply }]);
      if (voiceOn) speak(reply);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      setMessages([
        ...updated,
        {
          role: "assistant",
          content: "I'm sorry, I had trouble connecting. Could you say that again?",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handlePolicyUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);

    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/upload-token",
      });

      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: blob.url, name: file.name }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      if (data.kind === "pdf") {
        // PDF mode — Gemini will read the PDF natively
        setPolicy(""); // no inline text
        setPolicyPdfBase64(data.base64);
        setPolicyMeta({
          chars: 0,
          bytes: data.bytes,
        });
      } else {
        // Text mode (.txt or .md)
        setPolicy(data.text);
        setPolicyPdfBase64(null);
        setPolicyMeta({
          chars: data.characters,
        });
      }
      setPolicyName(data.name || file.name);
      setUsingDefault(false);
      // Reset call state so the agent re-introduces with the new policy context
      setCallStarted(false);
      setMessages([]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setUploadError(msg);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const resetToDefault = () => {
    setPolicy(DEFAULT_POLICY);
    setPolicyPdfBase64(null);
    setPolicyName(DEFAULT_POLICY_NAME);
    setPolicyMeta({ chars: DEFAULT_POLICY.length });
    setUsingDefault(true);
    setCallStarted(false);
    setMessages([]);
    setUploadError(null);
  };

  const startCall = () => {
    // Use the bundled greeting only if we're on the default policy.
    // For uploaded policies, generate a generic opener.
    const opener = usingDefault
      ? DEFAULT_GREETING
      : `Hello, I'm Maya, calling from your insurance partner. I'd love to walk you through ${policyName}. Do you have a few minutes?`;
    setMessages([{ role: "assistant", content: opener }]);
    setCallStarted(true);
    if (typeof window !== "undefined" && window.speechSynthesis) {
      // Trigger voices loading on Chrome
      window.speechSynthesis.getVoices();
    }
  };

  const toggleVoice = () => {
    if (voiceOn) {
      stopSpeaking();
    }
    setVoiceOn(!voiceOn);
  };

  let status = "Tap to speak";
  let statusColor = "#6B7280";
  if (loading) {
    status = "Maya is thinking...";
    statusColor = "#B89967";
  } else if (speaking) {
    status = "Maya is speaking...";
    statusColor = "#0F2E47";
  } else if (listening) {
    status = "Listening...";
    statusColor = "#0F2E47";
  }

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background: "linear-gradient(180deg, #F8F4ED 0%, #F2EBDB 100%)",
      }}
    >
      <div className="paper-grain min-h-screen relative">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md"
          onChange={handlePolicyUpload}
          className="hidden"
        />

        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 pb-40 relative z-10">
          {/* Header */}
          <header className="mb-8 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, #0F2E47 0%, #1A3D5C 100%)",
                  boxShadow: "0 8px 24px rgba(15, 46, 71, 0.18)",
                }}
              >
                <span
                  className="text-white"
                  style={{
                    fontFamily: "'Fraunces', serif",
                    fontSize: "20px",
                    fontWeight: 600,
                  }}
                >
                  A
                </span>
              </div>
              <div>
                <div
                  className="text-[11px] tracking-[0.25em] uppercase"
                  style={{ color: "#8B7355" }}
                >
                  Insurance Sales Desk
                </div>
                <h1
                  className="text-3xl sm:text-4xl leading-tight font-display"
                  style={{
                    color: "#0F2E47",
                    fontWeight: 500,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {usingDefault ? "Term Shield" : "Policy"} Conversation
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleVoice}
                className="p-2.5 rounded-full transition-colors"
                style={{
                  background: voiceOn ? "#0F2E47" : "#E5DDC8",
                  color: voiceOn ? "#FFF" : "#5A4A2E",
                }}
                title={voiceOn ? "Mute voice" : "Enable voice"}
              >
                {voiceOn ? (
                  <Volume2 className="w-4 h-4" />
                ) : (
                  <VolumeX className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={() => setShowPolicyDrawer(!showPolicyDrawer)}
                className="p-2.5 rounded-full bg-transparent border transition-colors"
                style={{ borderColor: "#D4C7A8", color: "#5A4A2E" }}
                title="View policy / upload"
              >
                <FileText className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Policy drawer */}
          {showPolicyDrawer && (
            <div
              className="mb-6 rounded-2xl overflow-hidden animate-fade-up"
              style={{
                background: "#FFFEFC",
                border: "1px solid #E5DDC8",
                boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
              }}
            >
              <div
                className="flex items-center justify-between px-5 py-3.5 border-b"
                style={{ borderColor: "#E5DDC8" }}
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4" style={{ color: "#B89967" }} />
                  <span
                    style={{
                      fontFamily: "'Fraunces', serif",
                      fontSize: "15px",
                      color: "#0F2E47",
                      fontWeight: 500,
                    }}
                  >
                    {policyName}
                  </span>
                  {usingDefault && (
                    <span
                      className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                      style={{ background: "#F2EBDB", color: "#8B7355" }}
                    >
                      Demo
                    </span>
                  )}
                  <span
                    className="text-xs"
                    style={{ color: "#8B7355" }}
                  >
                    {policyPdfBase64
                      ? `PDF \u00b7 ${((policyMeta.bytes || 0) / 1024).toFixed(0)} kB`
                      : `${(policyMeta.chars / 1000).toFixed(1)}k chars`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="text-xs flex items-center gap-1.5 px-2.5 py-1 rounded-md disabled:opacity-50"
                    style={{ color: "#0F2E47", background: "#F2EBDB" }}
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" /> Uploading
                      </>
                    ) : (
                      <>
                        <FileUp className="w-3 h-3" /> Upload
                      </>
                    )}
                  </button>
                  {!usingDefault && (
                    <button
                      onClick={resetToDefault}
                      className="text-xs flex items-center gap-1.5 px-2 py-1 rounded text-stone-600"
                      style={{ color: "#8B7355" }}
                      title="Reset to demo policy"
                    >
                      <RefreshCw className="w-3 h-3" /> Reset
                    </button>
                  )}
                  <button
                    onClick={() => setShowPolicyDrawer(false)}
                    style={{ color: "#8B7355" }}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="p-5 max-h-72 overflow-y-auto">
                {uploadError && (
                  <div
                    className="mb-3 px-3 py-2 rounded text-xs flex items-center gap-2"
                    style={{ background: "#FEF3C7", color: "#92400E" }}
                  >
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {uploadError}
                  </div>
                )}
                {policyPdfBase64 ? (
                  <div
                    className="text-sm py-4 px-2 italic"
                    style={{ color: "#5A4A2E" }}
                  >
                    Policy is a PDF document. Maya will read it directly when answering — no need for text extraction. The PDF is sent securely with each conversation turn.
                  </div>
                ) : (
                  <pre
                    className="text-xs whitespace-pre-wrap"
                    style={{
                      color: "#3D4A5C",
                      fontFamily: "monospace",
                      lineHeight: 1.7,
                    }}
                  >
                    {policy}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Pre-call screen */}
          {!callStarted ? (
            <div className="text-center py-12 animate-fade-up">
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6"
                style={{ background: "rgba(15, 46, 71, 0.06)", color: "#0F2E47" }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: "#10B981" }}
                />
                <span className="text-xs tracking-wider uppercase font-semibold">
                  {usingDefault ? "Demo policy loaded" : `${policyName} loaded`}
                </span>
              </div>
              <h2
                className="text-4xl sm:text-5xl mb-4 leading-tight font-display"
                style={{
                  color: "#0F2E47",
                  fontWeight: 400,
                  letterSpacing: "-0.02em",
                }}
              >
                A few minutes about your<br />
                <em style={{ color: "#B89967", fontStyle: "italic" }}>
                  family&apos;s protection
                </em>
                ?
              </h2>
              <p
                className="max-w-md mx-auto mb-8"
                style={{ color: "#5C6B7C", fontSize: "16px", lineHeight: 1.7 }}
              >
                Maya will walk you through the policy — pricing, claims, exclusions, anything you&apos;d like to know. Voice or text, your call.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  onClick={startCall}
                  className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full text-white transition-all hover:-translate-y-0.5"
                  style={{
                    background: "linear-gradient(135deg, #0F2E47 0%, #1A3D5C 100%)",
                    boxShadow: "0 12px 28px rgba(15, 46, 71, 0.25)",
                    fontWeight: 600,
                    fontSize: "15px",
                  }}
                >
                  <Phone className="w-4 h-4" />
                  Start the conversation
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-full transition-all disabled:opacity-50"
                  style={{
                    background: "transparent",
                    border: "1px solid #D4C7A8",
                    color: "#5A4A2E",
                    fontWeight: 500,
                    fontSize: "14px",
                  }}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Uploading...
                    </>
                  ) : (
                    <>
                      <FileUp className="w-4 h-4" /> Upload your own policy
                    </>
                  )}
                </button>
              </div>
              {uploadError && (
                <div
                  className="mt-4 inline-block px-3 py-2 rounded text-xs"
                  style={{ background: "#FEF3C7", color: "#92400E" }}
                >
                  {uploadError}
                </div>
              )}
              {!voiceSupported && (
                <p className="mt-6 text-xs" style={{ color: "#9C7B3D" }}>
                  Voice input not supported in this browser — text mode will work fine.
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Transcript */}
              <div className="space-y-5 mb-6">
                {messages.map((m, i) => (
                  <div key={i} className="animate-fade-up">
                    {m.role === "assistant" ? (
                      <div className="flex gap-3">
                        <div
                          className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center"
                          style={{
                            background:
                              "linear-gradient(135deg, #0F2E47 0%, #1A3D5C 100%)",
                          }}
                        >
                          <span
                            className="text-white"
                            style={{
                              fontFamily: "'Fraunces', serif",
                              fontSize: "14px",
                              fontWeight: 600,
                            }}
                          >
                            M
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div
                            className="text-[11px] tracking-wider uppercase mb-1"
                            style={{ color: "#B89967", fontWeight: 600 }}
                          >
                            Maya
                          </div>
                          <div
                            className="font-display"
                            style={{
                              color: "#1F2937",
                              fontSize: "16px",
                              lineHeight: 1.65,
                              fontWeight: 400,
                            }}
                          >
                            {m.content}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-3 justify-end">
                        <div className="flex-1 min-w-0 flex flex-col items-end">
                          <div
                            className="text-[11px] tracking-wider uppercase mb-1"
                            style={{ color: "#8B7355", fontWeight: 600 }}
                          >
                            You
                          </div>
                          <div
                            className="rounded-2xl px-4 py-3 max-w-[85%]"
                            style={{
                              background: "#0F2E47",
                              color: "#F8F4ED",
                              fontSize: "15px",
                              lineHeight: 1.55,
                            }}
                          >
                            {m.content}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {interim && (
                  <div className="flex gap-3 justify-end opacity-60">
                    <div className="flex-1 flex flex-col items-end">
                      <div
                        className="rounded-2xl px-4 py-3 max-w-[85%] italic"
                        style={{
                          background: "transparent",
                          border: "1px dashed #B89967",
                          color: "#5A4A2E",
                          fontSize: "15px",
                        }}
                      >
                        {interim}
                      </div>
                    </div>
                  </div>
                )}

                {loading && (
                  <div className="flex gap-3 animate-fade-up">
                    <div
                      className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center"
                      style={{
                        background:
                          "linear-gradient(135deg, #0F2E47 0%, #1A3D5C 100%)",
                      }}
                    >
                      <span
                        className="text-white"
                        style={{
                          fontFamily: "'Fraunces', serif",
                          fontSize: "14px",
                          fontWeight: 600,
                        }}
                      >
                        M
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-3">
                      <div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: "#B89967", animation: "wave 1.2s infinite" }}
                      />
                      <div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          background: "#B89967",
                          animation: "wave 1.2s infinite",
                          animationDelay: "0.15s",
                        }}
                      />
                      <div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          background: "#B89967",
                          animation: "wave 1.2s infinite",
                          animationDelay: "0.3s",
                        }}
                      />
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {error && (
                <div
                  className="mb-4 px-4 py-3 rounded-lg flex items-center gap-2 animate-fade-up"
                  style={{ background: "#FEF3C7", color: "#92400E", fontSize: "13px" }}
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Bottom voice control bar */}
        {callStarted && (
          <div
            className="fixed bottom-0 left-0 right-0 z-20"
            style={{
              background:
                "linear-gradient(180deg, transparent 0%, rgba(248, 244, 237, 0.95) 30%, #F8F4ED 100%)",
              paddingTop: "32px",
            }}
          >
            <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-6">
              <div className="flex flex-col items-center gap-3">
                {voiceSupported && (
                  <button
                    onClick={toggleListen}
                    disabled={loading}
                    className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all ${
                      listening
                        ? "animate-listen-pulse"
                        : !loading && !speaking
                        ? "animate-breathe"
                        : ""
                    }`}
                    style={{
                      background: listening
                        ? "#0F2E47"
                        : loading
                        ? "#9CA3AF"
                        : "linear-gradient(135deg, #B89967 0%, #9C7B3D 100%)",
                      boxShadow: listening
                        ? "0 8px 24px rgba(15, 46, 71, 0.3)"
                        : "0 8px 24px rgba(184, 153, 103, 0.25)",
                    }}
                  >
                    {speaking ? (
                      <div className="flex items-end gap-0.5 h-6">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <div
                            key={i}
                            className="wave-bar w-1 rounded-full"
                            style={{ height: "100%", background: "#FFF" }}
                          />
                        ))}
                      </div>
                    ) : (
                      <Mic className="w-7 h-7 text-white" strokeWidth={2} />
                    )}
                  </button>
                )}

                <div
                  className="text-sm font-medium tracking-wide"
                  style={{ color: statusColor, minHeight: "20px" }}
                >
                  {voiceSupported ? status : "Voice not supported — type below"}
                </div>

                {/* Text input fallback */}
                <div
                  className="w-full max-w-xl flex items-center gap-2 p-2 rounded-full"
                  style={{
                    background: "#FFFEFC",
                    border: "1px solid #E5DDC8",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.04)",
                  }}
                >
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Or type your question..."
                    disabled={loading}
                    className="flex-1 bg-transparent border-0 px-4 focus:outline-none"
                    style={{ color: "#1F2937", fontSize: "14px" }}
                  />
                  <button
                    onClick={() => sendMessage()}
                    disabled={loading || !input.trim()}
                    className="p-2 rounded-full disabled:opacity-30 transition-all"
                    style={{
                      background: loading || !input.trim() ? "#E5DDC8" : "#0F2E47",
                      color: loading || !input.trim() ? "#8B7355" : "#FFF",
                    }}
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </div>

                <div
                  className="text-[10px] tracking-wider uppercase mt-1"
                  style={{ color: "#9C8B6B" }}
                >
                  Insurance is the subject matter of solicitation · Demo for illustration
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
