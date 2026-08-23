import React, { useEffect, useRef, useState } from "react";
import styles from "./R1Chat.module.css";

type Message = {
  role: "user" | "assistant";
  text: string;
  imageUrl?: string;
};

type Turnstile = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: "auto" | "light" | "dark";
      size?: "normal" | "compact" | "flexible";
      action?: string;
      callback?: (token: string) => void;
      "error-callback"?: (errorCode: string) => void;
      "expired-callback"?: () => void;
    }
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
    r1TurnstileScriptPromise?: Promise<void>;
  }
}

const API_URL = "https://api.ashwanirathee.com/r1/chat";
const SESSION_URL = "https://api.ashwanirathee.com/r1/chat/session";

const TURNSTILE_SITE_KEY = "0x4AAAAAAEZX0_siEyyZJCxv";
const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const FALLBACK_QUESTIONS = [
  "What is R1?",
  "What hardware does R1 use?",
  "How is R1 using ROS 2?",
  "What experiments are included?",
  "What is the SLAM package?",
];

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.split(",")[1] ?? "");
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getFallbackReply(text: string): string {
  const query = text.toLowerCase();

  if (query.includes("what is r1") || query.includes("about r1")) {
    return "R1 is a Raspberry Pi 5-based RC car for experiments in perception, reasoning, and control. The live robot backend is currently offline.";
  }

  if (query.includes("hardware")) {
    return "R1 currently uses a Raspberry Pi 5 with camera input, ROS 2 nodes, audio support, and optional remote compute for heavier vision-language models.";
  }

  if (query.includes("slam")) {
    return "R1 includes an experimental monocular SLAM package for mapping and localization work.";
  }

  if (query.includes("experiments")) {
    return "The project includes experiments around vision classification, labeling, model comparison, object detection, and scene understanding.";
  }

  if (query.includes("ros")) {
    return "R1 is organized as modular ROS 2 packages for cameras, visual processing, brain logic, audio, actions, VLM, web UI, and SLAM.";
  }

  return "R1’s live backend is not responding right now. I can still answer basic questions about the project, hardware, ROS nodes, SLAM, and experiments from the website.";
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 100000
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) {
    return Promise.resolve();
  }

  if (window.r1TurnstileScriptPromise) {
    return window.r1TurnstileScriptPromise;
  }

  window.r1TurnstileScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_URL}"]`
    );

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Failed to load Cloudflare Turnstile.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load Cloudflare Turnstile."));
    document.head.appendChild(script);
  });

  return window.r1TurnstileScriptPromise;
}

export default function R1Chat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Hi, I am Murphy. You can ask me questions about the robot.",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [backendStatus, setBackendStatus] = useState<
    "unknown" | "online" | "offline"
  >("unknown");
  const [selectedImage, setSelectedImage] = useState<{
    file: File;
    previewUrl: string;
  } | null>(null);
  const [chatSessionToken, setChatSessionToken] = useState("");
  const [verifyingSession, setVerifyingSession] = useState(false);
  const [turnstileError, setTurnstileError] = useState(false);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || chatSessionToken) return;

    let cancelled = false;
    setTurnstileError(false);

    loadTurnstileScript()
      .then(() => {
        if (
          cancelled ||
          !turnstileContainerRef.current ||
          turnstileWidgetIdRef.current
        ) {
          return;
        }

        turnstileWidgetIdRef.current = window.turnstile?.render(
          turnstileContainerRef.current,
          {
            sitekey: TURNSTILE_SITE_KEY,
            theme: "auto",
            size: "flexible",
            action: "r1_chat",
            callback: (token) => {
              void createChatSession(token);
            },
            "error-callback": (errorCode) => {
              console.error("Turnstile error:", errorCode);
              setVerifyingSession(false);
              setTurnstileError(true);
            },
            "expired-callback": () => {
              setVerifyingSession(false);
            },
          }
        ) ?? null;
      })
      .catch((error) => {
        console.error("Failed to load Turnstile script:", error);
        if (!cancelled) {
          setTurnstileError(true);
        }
      });

    return () => {
      cancelled = true;
      const widgetId = turnstileWidgetIdRef.current;

      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }

      turnstileWidgetIdRef.current = null;
      setVerifyingSession(false);
      setTurnstileError(false);
    };
  }, [open, chatSessionToken]);

  async function createChatSession(turnstileToken: string) {
    if (verifyingSession || chatSessionToken) return;

    setVerifyingSession(true);
    setTurnstileError(false);

    try {
      const response = await fetchWithTimeout(
        SESSION_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ turnstileToken }),
        },
        15000
      );

      if (!response.ok) {
        console.error(
          "Chat session verification failed:",
          response.status,
          await response.text()
        );
        throw new Error(`Session verification returned ${response.status}`);
      }

      const data = await response.json();
      const sessionToken = data.sessionToken || data.token;

      if (!sessionToken) {
        throw new Error("Session response did not include a token.");
      }

      setChatSessionToken(sessionToken);

      if (turnstileWidgetIdRef.current) {
        window.turnstile?.remove(turnstileWidgetIdRef.current);
        turnstileWidgetIdRef.current = null;
      }
    } catch (error) {
      console.error("Failed to create chat session:", error);
      setTurnstileError(true);

      if (turnstileWidgetIdRef.current) {
        window.turnstile?.reset(turnstileWidgetIdRef.current);
      }
    } finally {
      setVerifyingSession(false);
    }
  }

  function clearSelectedImage() {
    if (selectedImage) {
      URL.revokeObjectURL(selectedImage.previewUrl);
    }

    setSelectedImage(null);
  }

  async function sendMessage(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    if (!chatSessionToken) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: turnstileError
            ? "Security check could not load. Please refresh and try again."
            : "Please complete the security check before sending.",
        },
      ]);
      return;
    }

    const imageToSend = selectedImage;
    const sessionTokenToSend = chatSessionToken;

    setInput("");
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text,
        imageUrl: imageToSend?.previewUrl,
      },
    ]);
    setLoading(true);

    try {
      const imagePayload = imageToSend
        ? {
            mime: imageToSend.file.type,
            base64: await fileToBase64(imageToSend.file),
          }
        : null;
      const response = await fetchWithTimeout(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          image: imagePayload,
          sessionToken: sessionTokenToSend,
        }),
      });

      if (!response.ok) {
        console.error("Backend returned error:", response.status, await response.text());
        throw new Error(`Backend returned ${response.status}`);
      }
      setBackendStatus("online");

      const data = await response.json();
      const reply =
        data.reply || data.message || "I received an empty response.";

      setMessages((prev) => [...prev, { role: "assistant", text: reply }]);
    } catch {
      setBackendStatus("offline");
      // If the API call fails, use a fallback response.
      const fallback = imageToSend
        ? "The live backend is offline, so I cannot inspect uploaded images right now."
        : getFallbackReply(text);

      setMessages((prev) => [...prev, { role: "assistant", text: fallback }]);
    } finally {
      setLoading(false);
      clearSelectedImage();
    }
  }

  return (
    <div className={styles.chatRoot}>
      {open && (
        <div className={styles.panel}>
          <div className={styles.header}>
            <span>Assistant</span>
            <button type="button" onClick={() => setOpen(false)}>
              x
            </button>
          </div>

          {backendStatus === "offline" && (
            <div className={styles.offlineBanner}>
              <strong>Live backend offline.</strong>
              <span>These questions have built-in answers.</span>
            </div>
          )}

          <div className={styles.messages}>
            {messages.map((message, index) => (
              <div
                key={index}
                className={
                  message.role === "user" ? styles.userMsg : styles.assistantMsg
                }
              >
                {message.imageUrl && (
                  <img
                    className={styles.messageImage}
                    src={message.imageUrl}
                    alt=""
                  />
                )}
                {message.text}
              </div>
            ))}
            {loading && <div className={styles.assistantMsg}>Thinking...</div>}
          </div>
          {backendStatus === "offline" && (
            <div className={styles.suggestions}>
              {FALLBACK_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => sendMessage(question)}
                >
                  {question}
                </button>
              ))}
            </div>
          )}

          {selectedImage && (
            <div className={styles.imagePreview}>
              <img src={selectedImage.previewUrl} alt="Selected upload" />
              <button type="button" onClick={clearSelectedImage}>
                Remove
              </button>
            </div>
          )}
          {!chatSessionToken && (
            <div className={styles.turnstileWrap}>
              <div ref={turnstileContainerRef} />
              {verifyingSession && <span>Verifying security check...</span>}
              {turnstileError && (
                <span>Security check failed to load. Refresh and try again.</span>
              )}
            </div>
          )}
          {chatSessionToken && (
            <div className={styles.sessionReady}>
              <span>Security check complete.</span>
            </div>
          )}
          <div className={styles.composer}>
            <label className={styles.attachButton} aria-label="Attach image">
              +
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;

                  if (file.size > MAX_IMAGE_SIZE_BYTES) {
                    setMessages((prev) => [
                      ...prev,
                      {
                        role: "assistant",
                        text: "Please choose an image smaller than 5 MB.",
                      },
                    ]);
                    event.target.value = "";
                    return;
                  }

                  if (selectedImage) {
                    URL.revokeObjectURL(selectedImage.previewUrl);
                  }

                  setSelectedImage({
                    file,
                    previewUrl: URL.createObjectURL(file),
                  });

                  event.target.value = "";
                }}
              />
            </label>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") sendMessage();
              }}
              placeholder="Ask Murphy..."
            />
            <button
              type="button"
              onClick={() => sendMessage()}
              disabled={loading || !chatSessionToken}
            >
              Send
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className={styles.bubble}
        onClick={() => setOpen((value) => !value)}
        aria-label="Open R1 assistant"
      >
        Chat
      </button>
    </div>
  );
}
