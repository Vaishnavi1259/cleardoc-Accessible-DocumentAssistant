"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import { createWorker } from "tesseract.js";
import { redact } from "@/lib/redact";

type PageMode = "home" | "workspace";

type WorkspaceStep = "upload" | "review" | "understand" | "questions" | "settings";

type Analysis = {
  document_type?: string;
  summary?: string;
  explanation?: string;

  criticalDetails?: Array<
    string | { type?: string; text?: string }
  >;

  actions?: string[];
  warnings?: string[];

  plain_version?: string;

  critical_details?: Array<
    string | { type?: string; text?: string }
  >;

  unclear_parts?: string[];

  [key: string]: unknown;
};

type Language = "English" | "Telugu" | "Hindi";
type ReadingLevel = "Simple" | "Standard" | "Detailed";
type CompareSpeechState = "idle" | "speaking" | "paused";

type SafetySignalType = "urgency" | "payment" | "sensitive_info" | "contact" | "link" | "mismatch" | "contradiction" | "unusual_request";

type SafetyResult = {
  status: "low_concern" | "needs_verification" | "multiple_risk_signals";
  summary: string;
  signals: Array<{
    type: SafetySignalType;
    severity: "low" | "medium" | "high";
    title: string;
    evidence: string;
    why: string;
    precaution: string;
  }>;
  before_you_act: string[];
};

type RedactionSession = {
  map: Record<string, string>;
  counters: Record<string, number>;
};

type CompareDocument = {
  text: string;
  maskedText: string;
  map: Record<string, string>;
  loading: boolean;
  pasteOpen: boolean;
  pasteDraft: string;
};

type CompareResult = {
  summary: string;
  change_level: "No major change" | "Minor changes" | "Important changes" | "Critical changes";
  added: string[];
  removed: string[];
  changed_values: Array<{ item: string; previous: string; current: string }>;
  changed_deadlines: Array<{ item: string; previous: string; current: string }>;
  changed_actions: Array<{ item: string; previous: string; current: string }>;
  other_differences: string[];
  pay_attention: string[];
};

const EMPTY_COMPARE_RESULT: CompareResult = {
  summary: "",
  change_level: "No major change",
  added: [],
  removed: [],
  changed_values: [],
  changed_deadlines: [],
  changed_actions: [],
  other_differences: [],
  pay_attention: [],
};

const EMPTY_COMPARE_DOCUMENT: CompareDocument = {
  text: "",
  maskedText: "",
  map: {},
  loading: false,
  pasteOpen: false,
  pasteDraft: "",
};

const subscribeToSpeechSupport = () => () => undefined;

function parseCompareResult(input: unknown): CompareResult {
  const rowArray = (value: unknown) => Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        item: typeof item.item === "string" ? item.item : "",
        previous: typeof item.previous === "string" ? item.previous : "",
        current: typeof item.current === "string" ? item.current : "",
      }))
    : [];
  const stringArray = (value: unknown) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

  if (!input || typeof input !== "object") return { ...EMPTY_COMPARE_RESULT };
  const value = input as Record<string, unknown>;
  const levels = ["No major change", "Minor changes", "Important changes", "Critical changes"] as const;
  return {
    summary: typeof value.summary === "string" ? value.summary : "",
    change_level: levels.includes(value.change_level as typeof levels[number])
      ? value.change_level as CompareResult["change_level"]
      : "No major change",
    added: stringArray(value.added),
    removed: stringArray(value.removed),
    changed_values: rowArray(value.changed_values),
    changed_deadlines: rowArray(value.changed_deadlines),
    changed_actions: rowArray(value.changed_actions),
    other_differences: stringArray(value.other_differences),
    pay_attention: stringArray(value.pay_attention),
  };
}

function parseSafetyResult(input: unknown): SafetyResult {
  if (!input || typeof input !== "object") throw new Error("Invalid safety response");
  const value = input as Record<string, unknown>;
  const statuses = ["low_concern", "needs_verification", "multiple_risk_signals"] as const;
  const signalTypes: SafetySignalType[] = ["urgency", "payment", "sensitive_info", "contact", "link", "mismatch", "contradiction", "unusual_request"];
  const severities = ["low", "medium", "high"] as const;
  if (!statuses.includes(value.status as SafetyResult["status"])) throw new Error("Invalid safety status");

  const signals = Array.isArray(value.signals)
    ? value.signals.flatMap((signal) => {
        if (!signal || typeof signal !== "object" || Array.isArray(signal)) return [];
        const item = signal as Record<string, unknown>;
        if (!signalTypes.includes(item.type as SafetySignalType) || !severities.includes(item.severity as SafetyResult["signals"][number]["severity"])) return [];
        return [{
          type: item.type as SafetySignalType,
          severity: item.severity as SafetyResult["signals"][number]["severity"],
          title: typeof item.title === "string" ? item.title : "",
          evidence: typeof item.evidence === "string" ? item.evidence : "",
          why: typeof item.why === "string" ? item.why : "",
          precaution: typeof item.precaution === "string" ? item.precaution : "",
        }];
      })
    : [];

  return {
    status: value.status as SafetyResult["status"],
    summary: typeof value.summary === "string" ? value.summary : "",
    signals,
    before_you_act: Array.isArray(value.before_you_act)
      ? value.before_you_act.filter((item): item is string => typeof item === "string")
      : [],
  };
}

const DEMO_DOCUMENT = `Dear Customer,

Your account 123456789 requires payment of ₹4,500 before 15 October.

Email: example@gmail.com
Phone: 9876543210

Please complete the payment before the deadline.`;

const DEMO_PROTECTED = `Dear Customer,

Your account [ACCOUNT_1] requires payment of ₹4,500 before 15 October.

Email: [EMAIL_2]
Phone: [PHONE_3]

Please complete the payment before the deadline.`;

const DEMO_ANALYSIS: Analysis = {
  document_type: "Bank Notice",
  summary:
    "This notice says that a payment of ₹4,500 needs to be completed before 15 October.",
  explanation:
    "This notice says that a payment of ₹4,500 needs to be completed before 15 October. If you are unsure about the payment or deadline, check the contact details provided in the document.",
  plain_version:
    "This notice says that a payment of ₹4,500 needs to be completed before 15 October. If you are unsure about the payment or deadline, check the contact details provided in the document.",
  critical_details: [
    { type: "Deadline", text: "15 October" },
    { type: "Amount", text: "₹4,500" },
    {
      type: "Action",
      text: "Make the payment before the deadline",
    },
  ],
  unclear_parts: [
    "The notice does not clearly explain what happens after the deadline.",
    "The document does not specify whether online or offline payment is required.",
  ],
  actions: ["Make the payment before the deadline."],
  warnings: [],
};

const DEMO_QUESTIONS = [
  "What is the deadline?",
  "How much do I need to pay?",
  "Who should I contact?",
  "Does this document mention a refund?",
];

const DEMO_ANSWERS: Record<string, string> = {
  "What is the deadline?":
    "The document states that the payment should be completed before 15 October.",
  "How much do I need to pay?":
    "The document states that ₹4,500 needs to be paid.",
  "Who should I contact?":
    "The document provides an email address and phone number, but it does not clearly identify a specific department or person to contact.",
  "Does this document mention a refund?":
    "No. The document does not mention a refund.",
};

function Icon({
  name,
  size = 20,
}: {
  name: string;
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5.5 9.5V21h13V9.5" />
          <path d="M9.5 21v-6h5v6" />
        </svg>
      );

    case "upload":
      return (
        <svg {...common}>
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M4 15v5h16v-5" />
        </svg>
      );

    case "document":
      return (
        <svg {...common}>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v5h4" />
          <path d="M9 13h6" />
          <path d="M9 17h5" />
        </svg>
      );

    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3 20 6v5c0 5-3.2 8.7-8 10-4.8-1.3-8-5-8-10V6z" />
          <path d="m8.5 12 2.2 2.2 4.8-5" />
        </svg>
      );

    case "check":
      return (
        <svg {...common}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );

    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
      );

    case "money":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="12" cy="12" r="3" />
          <path d="M7 9h.01M17 15h.01" />
        </svg>
      );

    case "accessibility":
      return (
        <svg {...common}>
          <circle cx="12" cy="4.5" r="2" />
          <path d="M5 8h14" />
          <path d="M12 7v12" />
          <path d="m8 21 4-7 4 7" />
        </svg>
      );

    case "volume":
      return (
        <svg {...common}>
          <path d="M4 10v4h4l5 4V6l-5 4z" />
          <path d="M16 9a4 4 0 0 1 0 6" />
          <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
        </svg>
      );

    case "pause":
      return (
        <svg {...common}>
          <path d="M8 5v14M16 5v14" />
        </svg>
      );

    case "stop":
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" rx="1" />
        </svg>
      );

    case "language":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
        </svg>
      );

    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.05.05-1.8 1.8-.05-.05a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.1 1.65V20h-2.55v-.09A1.8 1.8 0 0 0 11.2 18.3a1.8 1.8 0 0 0-2 .36l-.05.05-1.8-1.8.05-.05a1.8 1.8 0 0 0 .36-2A1.8 1.8 0 0 0 6.1 13.8H6V11.2h.1A1.8 1.8 0 0 0 7.75 10a1.8 1.8 0 0 0-.36-2l-.05-.05 1.8-1.8.05.05a1.8 1.8 0 0 0 2 .36A1.8 1.8 0 0 0 12.3 4.9V4.8h2.55v.1A1.8 1.8 0 0 0 16 6.55a1.8 1.8 0 0 0 2-.36l.05-.05 1.8 1.8-.05.05a1.8 1.8 0 0 0-.36 2A1.8 1.8 0 0 0 21.1 11.2h.1v2.6h-.1A1.8 1.8 0 0 0 19.4 15z" />
        </svg>
      );

    case "trash":
      return (
        <svg {...common}>
          <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      );

    case "help":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1.1-1.5 2.3" />
          <path d="M12 16.5h.01" />
        </svg>
      );

    case "menu":
      return (
        <svg {...common}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );

    case "close":
      return (
        <svg {...common}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );

    case "arrow":
      return (
        <svg {...common}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );

    case "paste":
      return (
        <svg {...common}>
          <rect x="6" y="4" width="13" height="16" rx="2" />
          <path d="M9 4V3h6v1M9 9h7M9 13h7M9 17h4" />
        </svg>
      );

    case "question":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1.1-1.5 2.3" />
          <path d="M12 16.5h.01" />
        </svg>
      );

    case "lock":
      return (
        <svg {...common}>
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      );

    case "eye":
      return (
        <svg {...common}>
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );

    case "chevron":
      return (
        <svg {...common}>
          <path d="m7 9 5 5 5-5" />
        </svg>
      );

    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}

function LogoMark({ large = false }: { large?: boolean }) {
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center ${
        large ? "h-24 w-24 rounded-[26px]" : "h-9 w-9 rounded-xl"
      }`}
      style={{
        background:
          "linear-gradient(145deg, rgba(18,91,88,.14), rgba(72,129,156,.12))",
        border: "1px solid rgba(18,91,88,.18)",
      }}
      aria-hidden="true"
    >
      <div
        className={`relative flex items-center justify-center ${
          large ? "h-14 w-12" : "h-6 w-5"
        } rounded-[5px] border-2`}
        style={{ borderColor: "#155e5a" }}
      >
        <div
          className={`absolute ${
            large ? "right-[-2px] top-[-2px] h-5 w-5" : "right-[-1px] top-[-1px] h-2.5 w-2.5"
          } rounded-bl-md border-b-2 border-l-2 bg-white`}
          style={{ borderColor: "#155e5a" }}
        />
        <div
          className={`absolute ${
            large ? "bottom-2.5 h-5 w-7" : "bottom-1.5 h-2.5 w-3.5"
          } rounded-full`}
          style={{
            background: "rgba(18,91,88,.10)",
            border: "1.5px solid #155e5a",
          }}
        />
        <div
          className={`absolute ${
            large ? "bottom-3.5 h-2 w-3.5" : "bottom-2 h-1 w-2"
          }`}
        >
          <svg viewBox="0 0 20 12" className="h-full w-full">
            <path
              d="M2 6l4 4L18 2"
              fill="none"
              stroke="#155e5a"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition focus:outline-none focus:ring-2 focus:ring-teal-700 focus:ring-offset-2 ${
        checked ? "bg-[#155e5a]" : "bg-slate-300"
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition ${
          checked ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}

export default function Page() {
  const [mode, setMode] = useState<PageMode>("home");
  const [step, setStep] = useState<WorkspaceStep>("upload");

  const [language, setLanguage] = useState<Language>("English");
  const [readingLevel, setReadingLevel] =
    useState<ReadingLevel>("Simple");

  const [largeText, setLargeText] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [accessibilityOpen, setAccessibilityOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState("");
  const [maskedText, setMaskedText] = useState("");
  const [redactionMap, setRedactionMap] = useState<Record<string, string>>(
    {}
  );
  const [compareDocuments, setCompareDocuments] = useState({
    previous: EMPTY_COMPARE_DOCUMENT,
    current: EMPTY_COMPARE_DOCUMENT,
  });
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState("");
  const [compareStatus, setCompareStatus] = useState("");
  const [compareSpeechState, setCompareSpeechState] = useState<CompareSpeechState>("idle");
  const compareSpeechAvailable = useSyncExternalStore(
    subscribeToSpeechSupport,
    () => typeof window !== "undefined" && "speechSynthesis" in window,
    () => false
  );
  const [compareInputRevision, setCompareInputRevision] = useState({ previous: 0, current: 0 });
  const compareSessionRef = useRef<RedactionSession>({ map: {}, counters: {} });
  const compareRawRef = useRef({ previous: "", current: "" });
  const compareOperationRef = useRef({ previous: 0, current: 0 });
  const compareRequestRef = useRef<AbortController | null>(null);

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [safetyResult, setSafetyResult] = useState<SafetyResult | null>(null);
  const [safetyLoading, setSafetyLoading] = useState(false);
  const [safetyError, setSafetyError] = useState(false);
  const safetyRequestRef = useRef<AbortController | null>(null);

  const [protectEnabled, setProtectEnabled] = useState(true);
  const [showProtectedModal, setShowProtectedModal] = useState(false);

  const [viewMode, setViewMode] =
    useState<"simple" | "original">("simple");

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [questionLoading, setQuestionLoading] = useState(false);

  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const [error, setError] = useState("");

  const [isDragging, setIsDragging] = useState(false);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const explanationText = useMemo(() => {
    if (!analysis) return "";

    return String(
      analysis.plain_version ||
        analysis.explanation ||
        analysis.summary ||
        ""
    );
  }, [analysis]);

  const criticalDetails = useMemo(() => {
    if (!analysis) return [];

    return (
      analysis.critical_details ||
      analysis.criticalDetails ||
      []
    );
  }, [analysis]);

  const unclearSections = useMemo(() => {
    if (!analysis) return [];

    return analysis.unclear_parts || [];
  }, [analysis]);

  const displayText = viewMode === "simple" ? explanationText : rawText;

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowProtectedModal(false);
        setDeleteDialogOpen(false);
        setAccessibilityOpen(false);
        setMobileMenuOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function goHome() {
    stopSpeech();
    setMode("home");
    setMobileMenuOpen(false);
  }

  function goWorkspace(target: WorkspaceStep = "upload") {
    setMode("workspace");
    setStep(target);
    setMobileMenuOpen(false);
  }

  function maskSensitiveInformation(text: string): string;
  function maskSensitiveInformation(
    text: string,
    session: RedactionSession
  ): { masked: string; map: Record<string, string>; session: RedactionSession };
  function maskSensitiveInformation(
    text: string,
    session?: RedactionSession
  ): string | { masked: string; map: Record<string, string>; session: RedactionSession } {
    let result = text;

    const map: Record<string, string> = {};
    let counter = 1;

    function replacePattern(pattern: RegExp, label: string) {
      result = result.replace(pattern, (match) => {
        const existing = session && Object.entries(session.map).find(
          ([placeholder, original]) =>
            placeholder.startsWith(`[${label}_`) && original === match
        )?.[0];
        const nextCount = session
          ? (session.counters[label] || 0) + 1
          : counter++;
        const placeholder = existing || `[${label}_${nextCount}]`;
        if (session && !existing) session.counters[label] = nextCount;
        map[placeholder] = match;
        if (session) session.map[placeholder] = match;
        return placeholder;
      });
    }

    replacePattern(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "AADHAAR");
    replacePattern(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "EMAIL"
    );
    replacePattern(/\b(?:\+91[\s-]?)?[6-9]\d{9}\b/g, "PHONE");
    replacePattern(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, "PAN");
    replacePattern(/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, "IFSC");
    replacePattern(/\b[a-zA-Z0-9._-]+@[a-zA-Z]{2,}\b/g, "UPI");
    replacePattern(
      /\b(?:Address|Residential Address|Permanent Address|Current Address|Mailing Address|Postal Address)\s*[:\-]\s*[^\n]+/gi,
      "ADDRESS"
    );
    replacePattern(/\b\d{11,18}\b/g, "ACCOUNT");
    replacePattern(/\b[1-9]\d{5}\b/g, "PIN");

    if (session) {
      replacePattern(/\b[A-Z][a-z]{1,}\s+[A-Z][a-z]{1,}\b/g, "NAME");
    }

    if (!session) {
      setRedactionMap(map);
      return result;
    }
    return { masked: result, map, session };
  }

  function restore(text: string | undefined) {
    if (!text) return "";

    let restored = text;

    for (const [placeholder, original] of Object.entries(redactionMap)) {
      restored = restored.split(placeholder).join(original);
    }

    return restored;
  }

  async function runOCR(selectedFile: File) {
    const worker = await createWorker("eng");

    try {
      const result = await worker.recognize(selectedFile);
      return result.data.text;
    } finally {
      await worker.terminate();
    }
  }

  async function readPDF(selectedFile: File) {
    const pdfjs = await import("pdfjs-dist");

    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

    const data = new Uint8Array(await selectedFile.arrayBuffer());

    const pdf = await pdfjs.getDocument({ data }).promise;

    let completeText = "";

    for (
      let pageNumber = 1;
      pageNumber <= pdf.numPages;
      pageNumber++
    ) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();

      const pageText = content.items
        .map((item: any) => ("str" in item ? item.str : ""))
        .join(" ");

      completeText += `\n${pageText}`;
    }

    const finalText = completeText.trim();

    if (!finalText) {
      throw new Error(
        "This PDF does not contain selectable text. Please upload a text-based PDF or use an image/screenshot of the document."
      );
    }

    return finalText;
  }

  async function extractText(selectedFile: File) {
    const type = selectedFile.type.toLowerCase();
    const name = selectedFile.name.toLowerCase();

    if (type === "application/pdf" || name.endsWith(".pdf")) {
      return readPDF(selectedFile);
    }

    if (
      type.startsWith("image/") ||
      /\.(png|jpg|jpeg|webp|bmp)$/i.test(name)
    ) {
      return runOCR(selectedFile);
    }

    if (
      type === "text/plain" ||
      name.endsWith(".txt") ||
      name.endsWith(".md")
    ) {
      return selectedFile.text();
    }

    if (name.endsWith(".docx")) {
      throw new Error(
        "DOCX was selected, but DOCX text extraction is not currently installed. Please use PDF, PNG, JPG, or TXT for this demo."
      );
    }

    throw new Error(
      "This file type is not supported. Please use PDF, PNG, JPG, or TXT."
    );
  }

  function clearSafetyCheck() {
    safetyRequestRef.current?.abort();
    safetyRequestRef.current = null;
    setSafetyResult(null);
    setSafetyLoading(false);
    setSafetyError(false);
  }

  async function runSafetyCheck(text: string, requestedLanguage: Language) {
    if (!text.trim()) return;
    safetyRequestRef.current?.abort();
    const controller = new AbortController();
    safetyRequestRef.current = controller;
    setSafetyResult(null);
    setSafetyError(false);
    setSafetyLoading(true);

    try {
      const response = await fetch("/api/safety-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ maskedText: text, language: requestedLanguage }),
      });
      if (!response.ok) throw new Error("Safety check failed");
      const result = parseSafetyResult(await response.json());
      if (safetyRequestRef.current === controller) setSafetyResult(result);
    } catch {
      if (!controller.signal.aborted && safetyRequestRef.current === controller) {
        setSafetyError(true);
      }
    } finally {
      if (safetyRequestRef.current === controller) {
        safetyRequestRef.current = null;
        setSafetyLoading(false);
      }
    }
  }

  async function processFile(selectedFile: File) {
    clearSafetyCheck();
    setError("");
    setFile(selectedFile);
    setAnalysis(null);
    setAnswer("");
    setQuestion("");
    setStep("upload");
    setFileLoading(true);

    try {
      const text = await extractText(selectedFile);

      if (!text.trim()) {
        throw new Error(
          "No readable text was found in this document."
        );
      }

      setRawText(text);

      const protectedText = maskSensitiveInformation(text);
      setMaskedText(protectedText);

      setStep("review");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to read this document."
      );
      setFile(null);
      setRawText("");
      setMaskedText("");
      setRedactionMap({});
    } finally {
      setFileLoading(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];

    if (selectedFile) {
      void processFile(selectedFile);
    }

    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);

    const droppedFile = event.dataTransfer.files?.[0];

    if (droppedFile) {
      void processFile(droppedFile);
    }
  }

  function updateCompareTexts(previousText: string, currentText: string) {
    const session: RedactionSession = { map: {}, counters: {} };
    const previousResult = maskSensitiveInformation(previousText, session);
    const currentResult = maskSensitiveInformation(currentText, previousResult.session);

    compareRawRef.current = { previous: previousText, current: currentText };
    compareSessionRef.current = currentResult.session;
    setCompareDocuments((documents) => ({
      previous: {
        ...documents.previous,
        text: previousText,
        maskedText: previousResult.masked,
        map: previousResult.map,
      },
      current: {
        ...documents.current,
        text: currentText,
        maskedText: currentResult.masked,
        map: currentResult.map,
      },
    }));
    setCompareResult(null);
    setCompareError("");
  }

  async function processCompareFile(
    version: "previous" | "current",
    selectedFile: File
  ) {
    const operation = ++compareOperationRef.current[version];
    setCompareDocuments((documents) => ({
      ...documents,
      [version]: { ...documents[version], loading: true },
    }));
    setCompareError("");

    try {
      const text = await extractText(selectedFile);
      if (compareOperationRef.current[version] !== operation) return;
      if (!text.trim()) throw new Error("No readable text was found in this document.");
      const next = { ...compareRawRef.current, [version]: text };
      updateCompareTexts(next.previous, next.current);
    } catch (err) {
      if (compareOperationRef.current[version] === operation) {
        setCompareError(err instanceof Error ? err.message : "Unable to read this document.");
      }
    } finally {
      if (compareOperationRef.current[version] === operation) {
        setCompareDocuments((documents) => ({
          ...documents,
          [version]: { ...documents[version], loading: false },
        }));
      }
    }
  }

  function handleCompareFileChange(
    version: "previous" | "current",
    event: ChangeEvent<HTMLInputElement>
  ) {
    const selectedFile = event.currentTarget.files?.[0];
    if (selectedFile) void processCompareFile(version, selectedFile);
    setCompareInputRevision((revision) => ({
      ...revision,
      [version]: revision[version] + 1,
    }));
  }

  function changeCompareText(version: "previous" | "current", text: string) {
    updateCompareTexts(
      version === "previous" ? text : compareRawRef.current.previous,
      version === "current" ? text : compareRawRef.current.current
    );
  }

  function getLocalHints(previousText: string, currentText: string) {
    const extract = (text: string) => [...new Set(
      text.match(/\[[A-Z]+_\d+\]|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}\b|(?:₹|Rs\.?|\$)\s?[\d,]+(?:\.\d{1,2})?|\b\d+(?:\.\d+)?%/gi) || []
    )];
    const previous = extract(previousText);
    const current = extract(currentText);
    return {
      previous,
      current,
      added: current.filter((value) => !previous.includes(value)),
      removed: previous.filter((value) => !current.includes(value)),
      unchanged: previous.filter((value) => current.includes(value)),
    };
  }

  async function compareDocumentsNow() {
    const { previous, current } = compareDocuments;
    if (!previous.maskedText.trim() || !current.maskedText.trim()) return;
    stopCompareSpeech();
    setCompareLoading(true);
    setCompareError("");
    setCompareStatus("");
    setCompareResult(null);
    compareRequestRef.current?.abort();
    const controller = new AbortController();
    compareRequestRef.current = controller;

    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          previousText: previous.maskedText,
          currentText: current.maskedText,
          language,
          localHints: getLocalHints(previous.maskedText, current.maskedText),
        }),
      });
      const responseText = await response.text();
      let data: unknown;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error("Could not compare these documents. Please try again.");
      }
      if (!response.ok) {
        const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : "Could not compare these documents. Please try again.";
        throw new Error(message);
      }
      if (!controller.signal.aborted) setCompareResult(parseCompareResult(data));
    } catch {
      if (!controller.signal.aborted) setCompareError("Could not compare these documents. Please try again.");
    } finally {
      if (compareRequestRef.current === controller) {
        compareRequestRef.current = null;
        setCompareLoading(false);
      }
    }
  }

  function cancelCompareRequest() {
    const controller = compareRequestRef.current;
    if (!controller) return;
    controller.abort();
    compareRequestRef.current = null;
    setCompareLoading(false);
    setCompareError("");
    setCompareStatus("Comparison cancelled.");
  }

  function toggleComparePaste(version: "previous" | "current") {
    setCompareDocuments((documents) => ({
      ...documents,
      [version]: { ...documents[version], pasteOpen: !documents[version].pasteOpen },
    }));
  }

  function setComparePasteDraft(version: "previous" | "current", value: string) {
    setCompareDocuments((documents) => ({
      ...documents,
      [version]: { ...documents[version], pasteDraft: value },
    }));
  }

  function acceptComparePaste(version: "previous" | "current") {
    const draft = compareDocuments[version].pasteDraft;
    if (!draft.trim()) {
      setCompareError("Please paste some document text first.");
      return;
    }
    changeCompareText(version, draft.trim());
    setCompareDocuments((documents) => ({
      ...documents,
      [version]: { ...documents[version], pasteOpen: false, pasteDraft: "" },
    }));
  }

  function usePasteText() {
    if (!pasteText.trim()) {
      setError("Please paste some document text first.");
      return;
    }

    setError("");
    clearSafetyCheck();

    const text = pasteText.trim();

    setRawText(text);

    const protectedText = maskSensitiveInformation(text);
    setMaskedText(protectedText);

    setFile(null);
    setAnalysis(null);
    setAnswer("");
    setStep("review");
    setPasteMode(false);
  }

  function loadDemoDocument() {
    clearSafetyCheck();
    setError("");
    setFile(null);
    setRawText(DEMO_DOCUMENT);
    setMaskedText(DEMO_PROTECTED);
    setRedactionMap({
      "[ACCOUNT_1]": "123456789",
      "[EMAIL_2]": "example@gmail.com",
      "[PHONE_3]": "9876543210",
    });
    setAnalysis(null);
    setAnswer("");
    setQuestion("");
    setStep("review");
  }

  async function simplifyDocument() {
    if (!maskedText.trim()) {
      setError("Please read a document first.");
      return;
    }

    setError("");
    setAnalysisLoading(true);
    void runSafetyCheck(maskedText, language);

    const textToAnalyze = protectEnabled ? maskedText : rawText;

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          maskedText: textToAnalyze,
          level: readingLevel,
          language,
        }),
      });

      const responseText = await response.text();

      let data: any = {};

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(
          responseText || "The analysis server returned invalid JSON."
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error ||
            data.message ||
            responseText ||
            "Unable to analyze the document."
        );
      }

      console.log("ClearDoc AI response:", data);

      setAnalysis(data);
      setStep("understand");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to simplify this document."
      );

      // Keep the demo usable during a hackathon even if the AI endpoint
      // is temporarily unavailable.
      if (
        rawText.includes("123456789") &&
        rawText.includes("₹4,500")
      ) {
        setAnalysis(DEMO_ANALYSIS);
        setStep("understand");
      }
    } finally {
      setAnalysisLoading(false);
    }
  }

  async function handleDocumentLanguageChange(newLanguage: Language) {
    setLanguage(newLanguage);

    if (!maskedText.trim()) {
      return;
    }

    stopSpeech();
    void runSafetyCheck(maskedText, newLanguage);
    setError("");
    setAnalysisLoading(true);

    const textToAnalyze = protectEnabled ? maskedText : rawText;

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          maskedText: textToAnalyze,
          level: readingLevel,
          language: newLanguage,
        }),
      });

      const responseText = await response.text();

      let data: any = {};

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(
          responseText || "The analysis server returned invalid JSON."
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error ||
            data.message ||
            responseText ||
            "Unable to change the document language."
        );
      }

      console.log("ClearDoc AI response after language change:", data);

      setAnalysis(data);
      setStep("understand");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to change the document language."
      );

      if (
        rawText.includes("123456789") &&
        rawText.includes("₹4,500")
      ) {
        setAnalysis(DEMO_ANALYSIS);
        setStep("understand");
      }
    } finally {
      setAnalysisLoading(false);
    }
  }

  async function handleDocumentReadingLevelChange(
    newReadingLevel: ReadingLevel
  ) {
    setReadingLevel(newReadingLevel);

    if (!maskedText.trim()) {
      return;
    }

    stopSpeech();
    setError("");
    setAnalysisLoading(true);

    const textToAnalyze = protectEnabled ? maskedText : rawText;

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          maskedText: textToAnalyze,
          level: newReadingLevel,
          language,
        }),
      });

      const responseText = await response.text();

      let data: any = {};

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(
          responseText || "The analysis server returned invalid JSON."
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error ||
            data.message ||
            responseText ||
            "Unable to change the reading level."
        );
      }

      console.log(
        "ClearDoc AI response after reading level change:",
        data
      );

      setAnalysis(data);
      setStep("understand");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to change the reading level."
      );

      if (
        rawText.includes("123456789") &&
        rawText.includes("₹4,500")
      ) {
        setAnalysis(DEMO_ANALYSIS);
        setStep("understand");
      }
    } finally {
      setAnalysisLoading(false);
    }
  }

  function speakText(
    textOverride?: string,
    onSpeechStateChange?: (state: CompareSpeechState) => void
  ) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setError("Read Aloud is not supported in this browser.");
      return;
    }

    const text = (typeof textOverride === "string" ? textOverride : "") || displayText || explanationText || rawText;

    if (!text.trim()) {
      setError("There is no text available to read.");
      return;
    }

    const synth = window.speechSynthesis;

    if (isPaused && !onSpeechStateChange) {
      synth.resume();
      setIsPaused(false);
      setIsSpeaking(true);
      return;
    }

    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    if (language === "Telugu") {
      utterance.lang = "te-IN";
    } else if (language === "Hindi") {
      utterance.lang = "hi-IN";
    } else {
      utterance.lang = "en-IN";
    }

    utterance.rate = 0.9;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsPaused(false);
      onSpeechStateChange?.("speaking");
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      onSpeechStateChange?.("idle");
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      onSpeechStateChange?.("idle");
    };

    synth.speak(utterance);
  }

  function pauseSpeech() {
    if (
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      isSpeaking
    ) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }

  function stopSpeech() {
    if (
      typeof window !== "undefined" &&
      "speechSynthesis" in window
    ) {
      window.speechSynthesis.cancel();
    }

    setIsSpeaking(false);
    setIsPaused(false);
  }

  function startCompareSpeech(text: string) {
    if (!compareSpeechAvailable) return;
    stopSpeech();
    setCompareSpeechState("speaking");
    speakText(text, setCompareSpeechState);
  }

  function pauseCompareSpeech() {
    if (!compareSpeechAvailable) return;
    window.speechSynthesis.pause();
    setIsPaused(true);
    setCompareSpeechState("paused");
  }

  function resumeCompareSpeech() {
    if (!compareSpeechAvailable) return;
    window.speechSynthesis.resume();
    setIsPaused(false);
    setIsSpeaking(true);
    setCompareSpeechState("speaking");
  }

  function stopCompareSpeech() {
    stopSpeech();
    setCompareSpeechState("idle");
  }

  async function askQuestion(customQuestion?: string) {
    const currentQuestion = (
      customQuestion ?? question
    ).trim();

    if (!currentQuestion) {
      setError("Please enter a question.");
      return;
    }

    setError("");
    setQuestion(currentQuestion);
    setQuestionLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: currentQuestion,
          maskedText: protectEnabled ? maskedText : rawText,
          language,
          level: readingLevel,
        }),
      });

      const responseText = await response.text();

      let data: any = {};

      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(
          responseText || "The question service returned invalid JSON."
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error ||
            data.message ||
            responseText ||
            "Unable to answer the question."
        );
      }

      const finalAnswer =
        data.answer ||
        data.response ||
        data.message ||
        data.content;

      setAnswer(
        finalAnswer ||
          "The document assistant could not find a clear answer in the document."
      );
    } catch (err) {
      const demoAnswer =
        DEMO_ANSWERS[currentQuestion];

      if (demoAnswer) {
        setAnswer(demoAnswer);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to answer this question."
        );
      }
    } finally {
      setQuestionLoading(false);
    }
  }

  function clearSession() {
    stopSpeech();
    clearSafetyCheck();
    setCompareSpeechState("idle");
    compareOperationRef.current.previous++;
    compareOperationRef.current.current++;
    compareRequestRef.current?.abort();
    compareRequestRef.current = null;

    setFile(null);
    setRawText("");
    setMaskedText("");
    setRedactionMap({});
    compareRawRef.current = { previous: "", current: "" };
    compareSessionRef.current = { map: {}, counters: {} };
    setCompareDocuments({ previous: EMPTY_COMPARE_DOCUMENT, current: EMPTY_COMPARE_DOCUMENT });
    setCompareResult(null);
    setCompareLoading(false);
    setCompareError("");
    setCompareStatus("");
    setCompareInputRevision((revision) => ({ previous: revision.previous + 1, current: revision.current + 1 }));
    setAnalysis(null);
    setAnswer("");
    setQuestion("");
    setError("");
    setPasteText("");
    setPasteMode(false);
    setProtectEnabled(true);
    setViewMode("simple");
    setStep("upload");
    setDeleteDialogOpen(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function getDetailText(
    detail: string | { type?: string; text?: string }
  ) {
    if (typeof detail === "string") return detail;
    return detail.text || "";
  }

  function getDetailType(
    detail: string | { type?: string; text?: string }
  ) {
    if (typeof detail === "string") return "Detail";
    return detail.type || "Detail";
  }

  function protectedCount() {
    return Object.keys(redactionMap).length;
  }

  const shellClass = highContrast
    ? "bg-black text-white"
    : "bg-[#f7f7f4] text-[#132a32]";

  const cardClass = highContrast
    ? "border-white/50 bg-black"
    : "border-[#dfe5e2] bg-white";

  return (
    <div
      className={`min-h-screen transition-all ${
        largeText ? "text-[17px]" : "text-[15px]"
      } ${shellClass}`}
    >
      {mode === "home" ? (
        <PublicHome
          highContrast={highContrast}
          largeText={largeText}
          onTry={() => goWorkspace("upload")}
          onAccessibility={() => setAccessibilityOpen(true)}
        />
      ) : (
        <Workspace
          highContrast={highContrast}
          largeText={largeText}
          language={language}
          setLanguage={setLanguage}
          onDocumentLanguageChange={handleDocumentLanguageChange}
          onDocumentReadingLevelChange={handleDocumentReadingLevelChange}
          accessibilityOpen={accessibilityOpen}
          setAccessibilityOpen={setAccessibilityOpen}
          onHome={goHome}
          mobileMenuOpen={mobileMenuOpen}
          setMobileMenuOpen={setMobileMenuOpen}
          step={step}
          setStep={setStep}
          file={file}
          fileLoading={fileLoading}
          rawText={rawText}
          maskedText={maskedText}
          protectedCount={protectedCount()}
          pasteMode={pasteMode}
          setPasteMode={setPasteMode}
          pasteText={pasteText}
          setPasteText={setPasteText}
          error={error}
          setError={setError}
          isDragging={isDragging}
          setIsDragging={setIsDragging}
          fileInputRef={fileInputRef}
          handleFileChange={handleFileChange}
          handleDrop={handleDrop}
          usePasteText={usePasteText}
          loadDemoDocument={loadDemoDocument}
          compareDocuments={compareDocuments}
          compareResult={compareResult}
          compareLoading={compareLoading}
          compareError={compareError}
          compareStatus={compareStatus}
          processCompareFile={processCompareFile}
          handleCompareFileChange={handleCompareFileChange}
          changeCompareText={changeCompareText}
          toggleComparePaste={toggleComparePaste}
          setComparePasteDraft={setComparePasteDraft}
          acceptComparePaste={acceptComparePaste}
          compareInputRevision={compareInputRevision}
          compareDocumentsNow={compareDocumentsNow}
          cancelCompareRequest={cancelCompareRequest}
          compareSpeechState={compareSpeechState}
          compareSpeechAvailable={compareSpeechAvailable}
          startCompareSpeech={startCompareSpeech}
          pauseCompareSpeech={pauseCompareSpeech}
          resumeCompareSpeech={resumeCompareSpeech}
          stopCompareSpeech={stopCompareSpeech}
          protectEnabled={protectEnabled}
          setProtectEnabled={setProtectEnabled}
          showProtectedModal={showProtectedModal}
          setShowProtectedModal={setShowProtectedModal}
          simplifyDocument={simplifyDocument}
          analysis={analysis}
          analysisLoading={analysisLoading}
          safetyResult={safetyResult}
          safetyLoading={safetyLoading}
          safetyError={safetyError}
          retrySafetyCheck={() => runSafetyCheck(maskedText, language)}
          criticalDetails={criticalDetails}
          explanationText={explanationText}
          viewMode={viewMode}
          setViewMode={setViewMode}
          readingLevel={readingLevel}
          setReadingLevel={setReadingLevel}
          displayText={displayText}
          unclearSections={unclearSections}
          speakText={speakText}
          pauseSpeech={pauseSpeech}
          stopSpeech={stopSpeech}
          isSpeaking={isSpeaking}
          isPaused={isPaused}
          question={question}
          setQuestion={setQuestion}
          answer={answer}
          questionLoading={questionLoading}
          askQuestion={askQuestion}
          setLargeText={setLargeText}
          setHighContrast={setHighContrast}
          clearSession={clearSession}
          deleteDialogOpen={deleteDialogOpen}
          setDeleteDialogOpen={setDeleteDialogOpen}
          cardClass={cardClass}
        />
      )}

      {accessibilityOpen && (
        <AccessibilityPanel
          highContrast={highContrast}
          largeText={largeText}
          language={language}
          setHighContrast={setHighContrast}
          setLargeText={setLargeText}
          setLanguage={setLanguage}
          onClose={() => setAccessibilityOpen(false)}
          onListen={() => speakText()}
          onPause={pauseSpeech}
          onStop={stopSpeech}
          isSpeaking={isSpeaking}
          isPaused={isPaused}
        />
      )}

      {deleteDialogOpen && (
        <DeleteDialog
          onCancel={() => setDeleteDialogOpen(false)}
          onDelete={clearSession}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* PUBLIC HOME                                                               */
/* -------------------------------------------------------------------------- */

function PublicHome({
  onTry,
  onAccessibility,
  highContrast,
  largeText,
}: {
  onTry: () => void;
  onAccessibility: () => void;
  highContrast: boolean;
  largeText: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  function scrollTo(id: string) {
    setMobileOpen(false);
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  return (
    <div
      className={`min-h-screen ${
        highContrast
          ? "bg-black text-white"
          : "bg-[#f7f7f4] text-[#132a32]"
      }`}
    >
      <header className="sticky top-0 z-30 border-b border-[#dfe5e2] bg-[#f7f7f4]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 lg:px-8">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="flex items-center gap-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#155e5a]"
            aria-label="Go to ClearDoc home"
          >
            <LogoMark />
            <div className="text-left">
              <div className="font-semibold tracking-tight">ClearDoc</div>
              <div className="text-[10px] font-medium uppercase tracking-[0.15em] text-[#70817e]">
                Accessible documents
              </div>
            </div>
          </button>

          <nav className="hidden items-center gap-7 lg:flex">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="text-sm font-medium text-[#155e5a]"
            >
              Home
            </button>

            <button
              onClick={() => scrollTo("how-it-works")}
              className="text-sm font-medium text-[#536866] hover:text-[#155e5a]"
            >
              How It Works
            </button>

            <button
              onClick={() => scrollTo("privacy")}
              className="text-sm font-medium text-[#536866] hover:text-[#155e5a]"
            >
              Privacy
            </button>

            <button
              onClick={() => {
                scrollTo("accessibility");
                onAccessibility();
              }}
              className="text-sm font-medium text-[#536866] hover:text-[#155e5a]"
            >
              Accessibility
            </button>
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <button
              type="button"
              onClick={onTry}
              className="inline-flex items-center gap-2 rounded-xl bg-[#155e5a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#104d4a] focus:outline-none focus:ring-2 focus:ring-[#155e5a] focus:ring-offset-2"
            >
              Try ClearDoc
              <Icon name="arrow" size={16} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="rounded-xl border border-[#d6dfdc] p-2 lg:hidden"
            aria-label="Open navigation menu"
            aria-expanded={mobileOpen}
          >
            <Icon name={mobileOpen ? "close" : "menu"} />
          </button>
        </div>

        {mobileOpen && (
          <div className="border-t border-[#dfe5e2] bg-white px-5 py-4 lg:hidden">
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setMobileOpen(false);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="rounded-lg px-3 py-2 text-left font-medium"
              >
                Home
              </button>

              <button
                onClick={() => scrollTo("how-it-works")}
                className="rounded-lg px-3 py-2 text-left font-medium"
              >
                How It Works
              </button>

              <button
                onClick={() => scrollTo("privacy")}
                className="rounded-lg px-3 py-2 text-left font-medium"
              >
                Privacy
              </button>

              <button
                onClick={() => {
                  scrollTo("accessibility");
                  onAccessibility();
                }}
                className="rounded-lg px-3 py-2 text-left font-medium"
              >
                Accessibility
              </button>

              <button
                onClick={onTry}
                className="mt-2 rounded-xl bg-[#155e5a] px-4 py-3 text-left font-semibold text-white"
              >
                Try ClearDoc →
              </button>
            </div>
          </div>
        )}
      </header>

      <main>
        {/* HERO */}
        <section className="mx-auto grid max-w-7xl items-center gap-10 px-5 py-14 sm:py-20 lg:grid-cols-[1.05fr_.95fr] lg:px-8 lg:py-24">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#cfdedb] bg-white px-3 py-1.5 text-xs font-semibold text-[#155e5a]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#155e5a]" />
              Privacy-first document accessibility
            </div>

            <h1
              className={`max-w-3xl font-semibold tracking-[-0.04em] ${
                largeText
                  ? "text-5xl sm:text-6xl"
                  : "text-4xl sm:text-5xl lg:text-[4.25rem]"
              }`}
            >
              Understand your documents without the confusion.
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-7 text-[#5f706d] sm:text-lg">
              ClearDoc turns complex documents into simple, accessible
              explanations while helping protect sensitive information before
              AI processing.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={onTry}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#155e5a] px-5 py-3.5 font-semibold text-white shadow-sm hover:bg-[#104d4a] focus:outline-none focus:ring-2 focus:ring-[#155e5a] focus:ring-offset-2"
              >
                Try ClearDoc
                <Icon name="arrow" size={17} />
              </button>

              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById("how-it-works")
                    ?.scrollIntoView({
                      behavior: "smooth",
                    })
                }
                className="inline-flex items-center justify-center rounded-xl border border-[#cfd9d6] bg-white px-5 py-3.5 font-semibold text-[#173c42] hover:border-[#155e5a] focus:outline-none focus:ring-2 focus:ring-[#155e5a]"
              >
                See How It Works
              </button>
            </div>

            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[#687a77]">
              <span className="inline-flex items-center gap-1.5">
                <Icon name="shield" size={15} />
                Sensitive information masked
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Icon name="accessibility" size={15} />
                Built for accessibility
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Icon name="document" size={15} />
                No account required
              </span>
            </div>
          </div>

          {/* IMPORTANT: BRAND VISUAL ONLY — NO BANK NOTICE HERE */}
          <div className="relative flex min-h-[360px] items-center justify-center lg:min-h-[430px]">
            <div className="absolute h-72 w-72 rounded-full bg-[#dceceb] blur-3xl" />

            <div className="relative w-full max-w-[440px]">
              <div className="rounded-[30px] border border-[#d8e3e0] bg-white p-7 shadow-[0_24px_60px_rgba(26,58,58,.10)]">
                <div className="flex items-center justify-between border-b border-[#edf0ef] pb-5">
                  <div className="flex items-center gap-3">
                    <LogoMark />
                    <div>
                      <div className="font-semibold tracking-tight">
                        ClearDoc
                      </div>
                      <div className="text-xs text-[#748480]">
                        Accessible Document Assistant
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg bg-[#eef7f5] px-2.5 py-1.5 text-xs font-semibold text-[#155e5a]">
                    Protected
                  </div>
                </div>

                <div className="flex items-center justify-center py-12">
                  <div className="relative">
                    <div className="absolute inset-[-28px] rounded-full bg-[#edf7f5]" />
                    <div className="absolute inset-[-50px] rounded-full border border-[#e1eeec]" />

                    <LogoMark large />

                    <div className="absolute -right-10 top-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-[#d9e7e4] bg-white text-[#155e5a] shadow-sm">
                      <Icon name="shield" size={21} />
                    </div>

                    <div className="absolute -bottom-5 -left-10 flex h-11 w-11 items-center justify-center rounded-2xl border border-[#e1e2ef] bg-[#f5f4fb] text-[#586182] shadow-sm">
                      <Icon name="document" size={21} />
                    </div>

                    <div className="absolute -bottom-4 -right-7 flex h-11 w-11 items-center justify-center rounded-2xl border border-[#e8dfe3] bg-[#fbf3f5] text-[#8c6470] shadow-sm">
                      <Icon name="accessibility" size={21} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <BrandFeature
                    icon="document"
                    title="Documents"
                    text="Read"
                  />
                  <BrandFeature
                    icon="shield"
                    title="Protection"
                    text="Mask"
                  />
                  <BrandFeature
                    icon="check"
                    title="Clarity"
                    text="Understand"
                  />
                </div>
              </div>

              <div className="mx-auto mt-3 max-w-[350px] text-center text-xs text-[#71807e]">
                Documents · Clarity · Accessibility · Protection
              </div>
            </div>
          </div>
        </section>

        {/* PROTECT / UNDERSTAND / ACT */}
        <section className="mx-auto max-w-7xl px-5 pb-12 lg:px-8">
          <div className="grid gap-4 md:grid-cols-3">
            <PhilosophyCard
              number="01"
              title="PROTECT"
              text="Sensitive information is detected and masked before protected text is sent to AI."
              icon="shield"
              className="bg-[#edf7f5]"
            />
            <PhilosophyCard
              number="02"
              title="UNDERSTAND"
              text="Complex documents are converted into simple explanations and structured information."
              icon="document"
              className="bg-[#f1f5fa]"
            />
            <PhilosophyCard
              number="03"
              title="ACT"
              text="Important deadlines, amounts and required actions are clearly highlighted."
              icon="check"
              className="bg-[#f8f2f4]"
            />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section
          id="how-it-works"
          className="scroll-mt-20 border-y border-[#e1e6e4] bg-white"
        >
          <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
            <SectionHeading
              eyebrow="HOW IT WORKS"
              title="How ClearDoc works"
              text="A simple workflow from document to understanding."
            />

            <div className="mt-8 grid gap-4 md:grid-cols-4">
              <HowStep
                number="01"
                title="Upload"
                text="Upload a document, image or paste text."
              />
              <HowStep
                number="02"
                title="Review & Protect"
                text="Review extracted text and see what information will be protected."
              />
              <HowStep
                number="03"
                title="Understand"
                text="Get a simple explanation and important details."
              />
              <HowStep
                number="04"
                title="Listen & Access"
                text="Use read aloud, large text, high contrast and regional languages."
              />
            </div>
          </div>
        </section>

        {/* DOCUMENT TYPES */}
        <section className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
          <SectionHeading
            eyebrow="DOCUMENT TYPES"
            title="Built for documents that matter"
            text="ClearDoc is designed around everyday documents that can be difficult to understand."
          />

          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Bank Notices", "money"],
              ["Bank Statements", "document"],
              ["Insurance Documents", "shield"],
              ["Government Forms", "document"],
              ["College Forms", "document"],
              ["Employment Documents", "document"],
              ["Medical Reports", "document"],
              ["Other Important Documents", "check"],
            ].map(([title, icon]) => (
              <div
                key={title}
                className="rounded-2xl border border-[#dfe6e3] bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-sm"
              >
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-[#eef5f3] text-[#155e5a]">
                  <Icon name={icon} size={18} />
                </div>
                <div className="text-sm font-semibold">{title}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ACCESSIBILITY */}
        <section
          id="accessibility"
          className="scroll-mt-20 border-y border-[#e1e6e4] bg-[#f0f6f4]"
        >
          <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
            <div className="grid items-center gap-8 lg:grid-cols-[.8fr_1.2fr]">
              <div>
                <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[#155e5a]">
                  ACCESSIBILITY
                </div>
                <h2 className="text-3xl font-semibold tracking-tight">
                  Designed for everyone
                </h2>
                <p className="mt-3 max-w-xl leading-7 text-[#61716f]">
                  ClearDoc is designed to make difficult documents easier to
                  read, understand and access.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <AccessibilityFeature icon="accessibility" text="A+ Large Text" />
                <AccessibilityFeature icon="shield" text="High Contrast" />
                <AccessibilityFeature icon="volume" text="Read Aloud" />
                <AccessibilityFeature icon="language" text="English" />
                <AccessibilityFeature icon="language" text="తెలుగు" />
                <AccessibilityFeature icon="language" text="हिन्दी" />
              </div>
            </div>
          </div>
        </section>

        {/* PRIVACY */}
        <section
          id="privacy"
          className="scroll-mt-20 mx-auto max-w-7xl px-5 py-14 lg:px-8"
        >
          <div className="grid items-start gap-10 lg:grid-cols-[.85fr_1.15fr]">
            <div>
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[#155e5a]">
                PRIVACY
              </div>

              <h2 className="text-3xl font-semibold tracking-tight">
                Privacy-first document processing
              </h2>

              <p className="mt-4 max-w-xl leading-7 text-[#61716f]">
                ClearDoc extracts text first and masks common sensitive
                identifiers before sending protected text to AI.
              </p>

              <div className="mt-6 flex flex-wrap gap-2">
                <span className="rounded-lg bg-[#edf7f5] px-3 py-2 text-xs font-semibold text-[#155e5a]">
                  Review before sharing
                </span>

                <span className="rounded-lg border border-[#d7dfdd] bg-white px-3 py-2 text-xs font-semibold">
                  View what was sent to AI
                </span>
              </div>
            </div>

            <div className="grid overflow-hidden rounded-2xl border border-[#dfe6e3] bg-white sm:grid-cols-2">
              <div className="border-b border-[#e6ebe9] p-5 sm:border-b-0 sm:border-r">
                <div className="mb-4 text-xs font-bold uppercase tracking-[0.12em] text-[#788783]">
                  Original
                </div>

                <div className="space-y-3 font-mono text-sm">
                  <div>
                    <span className="text-[#77837f]">Aadhaar:</span>{" "}
                    4567 8912 3456
                  </div>
                  <div>
                    <span className="text-[#77837f]">Email:</span>{" "}
                    example@gmail.com
                  </div>
                </div>
              </div>

              <div className="bg-[#f3f8f6] p-5">
                <div className="mb-4 text-xs font-bold uppercase tracking-[0.12em] text-[#155e5a]">
                  Protected
                </div>

                <div className="space-y-3 font-mono text-sm">
                  <div>
                    <span className="text-[#77837f]">Aadhaar:</span>{" "}
                    <span className="rounded bg-[#dfeeea] px-1.5 py-0.5 text-[#155e5a]">
                      [AADHAAR_1]
                    </span>
                  </div>

                  <div>
                    <span className="text-[#77837f]">Email:</span>{" "}
                    <span className="rounded bg-[#dfeeea] px-1.5 py-0.5 text-[#155e5a]">
                      [EMAIL_1]
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-7xl px-5 pb-14 lg:px-8">
          <div className="rounded-[24px] border border-[#d7e3e0] bg-[#eaf4f1] px-6 py-10 text-center sm:px-10">
            <h2 className="text-3xl font-semibold tracking-tight">
              Ready to understand your document?
            </h2>

            <p className="mx-auto mt-3 max-w-xl leading-7 text-[#61716f]">
              Upload a document and let ClearDoc turn complex information into
              something easier to understand.
            </p>

            <button
              type="button"
              onClick={onTry}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#155e5a] px-5 py-3.5 font-semibold text-white hover:bg-[#104d4a] focus:outline-none focus:ring-2 focus:ring-[#155e5a] focus:ring-offset-2"
            >
              Try ClearDoc
              <Icon name="arrow" size={17} />
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#dfe6e3] bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-8 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <LogoMark />
            <div>
              <div className="font-semibold">ClearDoc</div>
              <div className="text-xs text-[#778783]">
                Accessible Document Assistant
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-[#647470]">
            <button onClick={() => window.scrollTo({ top: 0 })}>
              Home
            </button>
            <button
              onClick={() =>
                document
                  .getElementById("how-it-works")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              How It Works
            </button>
            <button
              onClick={() =>
                document
                  .getElementById("privacy")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              Privacy
            </button>
            <button onClick={onAccessibility}>Accessibility</button>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* WORKSPACE                                                                  */
/* -------------------------------------------------------------------------- */

function Workspace({
  highContrast,
  largeText,
  language,
  setLanguage,
  onDocumentLanguageChange,
  onDocumentReadingLevelChange,
  accessibilityOpen,
  setAccessibilityOpen,
  onHome,
  mobileMenuOpen,
  setMobileMenuOpen,
  step,
  setStep,
  file,
  fileLoading,
  rawText,
  maskedText,
  protectedCount,
  pasteMode,
  setPasteMode,
  pasteText,
  setPasteText,
  error,
  setError,
  isDragging,
  setIsDragging,
  fileInputRef,
  handleFileChange,
  handleDrop,
  usePasteText,
  loadDemoDocument,
  compareDocuments,
  compareResult,
  compareLoading,
  compareError,
  compareStatus,
  processCompareFile,
  handleCompareFileChange,
  changeCompareText,
  toggleComparePaste,
  setComparePasteDraft,
  acceptComparePaste,
  compareInputRevision,
  compareDocumentsNow,
  cancelCompareRequest,
  compareSpeechState,
  compareSpeechAvailable,
  startCompareSpeech,
  pauseCompareSpeech,
  resumeCompareSpeech,
  stopCompareSpeech,
  protectEnabled,
  setProtectEnabled,
  showProtectedModal,
  setShowProtectedModal,
  simplifyDocument,
  analysis,
  analysisLoading,
  safetyResult,
  safetyLoading,
  safetyError,
  retrySafetyCheck,
  criticalDetails,
  explanationText,
  viewMode,
  setViewMode,
  readingLevel,
  setReadingLevel,
  displayText,
  unclearSections,
  speakText,
  pauseSpeech,
  stopSpeech,
  isSpeaking,
  isPaused,
  question,
  setQuestion,
  answer,
  questionLoading,
  askQuestion,
  largeText: currentLargeText,
  setLargeText,
  setHighContrast,
  clearSession,
  deleteDialogOpen,
  setDeleteDialogOpen,
  cardClass,
}: any) {
  const navItems: {
    key: WorkspaceStep;
    label: string;
    icon: string;
  }[] = [
    { key: "upload", label: "Upload", icon: "upload" },
    { key: "review", label: "Review & Protect", icon: "shield" },
    { key: "understand", label: "Understand", icon: "document" },
    { key: "questions", label: "Ask Questions", icon: "question" },
    { key: "settings", label: "Settings", icon: "settings" },
  ];

  function canOpen(target: WorkspaceStep) {
    if (target === "upload" || target === "settings") return true;
    if (target === "review") return !!rawText;
    if (target === "understand")
      return !!rawText && (!!analysis || rawText.includes("₹4,500"));
    if (target === "questions")
      return !!rawText && (!!analysis || rawText.includes("₹4,500"));

    return true;
  }

  function handleNav(target: WorkspaceStep) {
    if (!canOpen(target)) return;

    setStep(target);
    setMobileMenuOpen(false);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* DESKTOP SIDEBAR */}
      <aside
        className={`hidden h-screen w-[245px] shrink-0 overflow-y-auto border-r lg:flex lg:flex-col ${
          highContrast
            ? "border-white/30 bg-black"
            : "border-[#dfe6e3] bg-white"
        }`}
      >
        <div className="p-4">
          <button
            type="button"
            onClick={onHome}
            className="flex w-full items-center gap-3 rounded-xl p-2 text-left focus:outline-none focus:ring-2 focus:ring-[#155e5a]"
          >
            <LogoMark />

            <div>
              <div className="font-semibold tracking-tight">ClearDoc</div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-[#778783]">
                Document assistant
              </div>
            </div>
          </button>
        </div>

        <nav className="px-3">
          <button
            onClick={onHome}
            className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${
              step === "upload"
                ? "bg-[#edf5f3] text-[#155e5a]"
                : "text-[#60716e] hover:bg-[#f5f7f6]"
            }`}
          >
            <Icon name="home" size={18} />
            Home
          </button>

          {navItems.map((item) => {
            const active = step === item.key;
            const available = canOpen(item.key);

            return (
              <button
                key={item.key}
                onClick={() => handleNav(item.key)}
                disabled={!available}
                className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-[#edf5f3] text-[#155e5a]"
                    : available
                    ? "text-[#60716e] hover:bg-[#f5f7f6]"
                    : "cursor-not-allowed text-[#b4c0bd]"
                }`}
              >
                <Icon name={item.icon} size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto p-3">
          <button
            onClick={() => setAccessibilityOpen(true)}
            className="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#60716e] hover:bg-[#f5f7f6]"
          >
            <Icon name="accessibility" size={18} />
            Accessibility
          </button>

          <button
            onClick={() => setDeleteDialogOpen(true)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#8c5960] hover:bg-[#fbf1f2]"
          >
            <Icon name="trash" size={18} />
            Delete / Clear Session
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <header
          className={`sticky top-0 z-20 border-b ${
            highContrast
              ? "border-white/30 bg-black/95"
              : "border-[#dfe6e3] bg-[#f7f7f4]/95"
          } backdrop-blur`}
        >
          <div className="flex h-[66px] items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="rounded-lg p-2 lg:hidden"
                aria-label="Open workspace navigation"
              >
                <Icon name="menu" />
              </button>

              <button
                type="button"
                onClick={onHome}
                className="hidden items-center gap-2 rounded-lg lg:flex"
              >
                <span className="font-semibold">ClearDoc</span>
              </button>

              <div className="hidden h-5 w-px bg-[#d9e0de] lg:block" />

              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  ClearDoc
                </div>
                <div className="hidden truncate text-xs text-[#778783] sm:block">
                  Understand your documents with confidence
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={language}
                onChange={(event) =>
                  setLanguage(event.target.value as Language)
                }
                className="hidden rounded-lg border border-[#d7dfdd] bg-white px-2.5 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-[#155e5a] sm:block"
                aria-label="Language"
              >
                <option>English</option>
                <option>Telugu</option>
                <option>Hindi</option>
              </select>

              <button
                type="button"
                onClick={() => setAccessibilityOpen(true)}
                className="rounded-lg border border-[#d7dfdd] bg-white p-2 text-[#516763] hover:text-[#155e5a]"
                aria-label="Accessibility controls"
              >
                <Icon name="accessibility" size={17} />
              </button>

              <button
                type="button"
                onClick={() => setAccessibilityOpen(true)}
                className="hidden rounded-lg border border-[#d7dfdd] bg-white p-2 text-[#516763] hover:text-[#155e5a] sm:block"
                aria-label="Help and accessibility"
              >
                <Icon name="help" size={17} />
              </button>

              <button
                type="button"
                onClick={() => setDeleteDialogOpen(true)}
                className="hidden items-center gap-1.5 rounded-lg border border-[#ead4d7] bg-white px-3 py-2 text-xs font-semibold text-[#8c5960] hover:bg-[#fbf1f2] sm:flex"
              >
                <Icon name="trash" size={15} />
                Delete Now
              </button>
            </div>
          </div>
        </header>

        {/* MOBILE SIDEBAR */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              className="absolute inset-0 bg-black/30"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close navigation"
            />

            <aside className="relative flex h-full w-[280px] flex-col bg-white p-4 shadow-xl">
              <div className="mb-5 flex items-center justify-between">
                <button
                  onClick={onHome}
                  className="flex items-center gap-3"
                >
                  <LogoMark />
                  <span className="font-semibold">ClearDoc</span>
                </button>

                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-lg p-2"
                  aria-label="Close navigation"
                >
                  <Icon name="close" />
                </button>
              </div>

              <button
                onClick={onHome}
                className="mb-1 flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-[#60716e]"
              >
                <Icon name="home" size={18} />
                Home
              </button>

              {navItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => handleNav(item.key)}
                  disabled={!canOpen(item.key)}
                  className={`mb-1 flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium ${
                    step === item.key
                      ? "bg-[#edf5f3] text-[#155e5a]"
                      : "text-[#60716e]"
                  }`}
                >
                  <Icon name={item.icon} size={18} />
                  {item.label}
                </button>
              ))}

              <div className="mt-auto border-t border-[#e4e9e7] pt-3">
                <button
                  onClick={() => {
                    setAccessibilityOpen(true);
                    setMobileMenuOpen(false);
                  }}
                  className="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-[#60716e]"
                >
                  <Icon name="accessibility" size={18} />
                  Accessibility
                </button>

                <button
                  onClick={() => {
                    setDeleteDialogOpen(true);
                    setMobileMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-[#8c5960]"
                >
                  <Icon name="trash" size={18} />
                  Delete / Clear Session
                </button>
              </div>
            </aside>
          </div>
        )}

        <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
          <StepIndicator step={step} />

          {error && (
            <div
              role="alert"
              className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-[#e7cfd3] bg-[#fff6f7] px-4 py-3 text-sm text-[#7d4e56]"
            >
              <div>
                <div className="font-semibold">Something needs attention</div>
                <div className="mt-1">{error}</div>
              </div>

              <button
                onClick={() => setError("")}
                className="rounded p-1"
                aria-label="Dismiss error"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}

          {step === "upload" && (
            <UploadScreen
              file={file}
              fileLoading={fileLoading}
              pasteMode={pasteMode}
              setPasteMode={setPasteMode}
              pasteText={pasteText}
              setPasteText={setPasteText}
              isDragging={isDragging}
              setIsDragging={setIsDragging}
              fileInputRef={fileInputRef}
              handleFileChange={handleFileChange}
              handleDrop={handleDrop}
              usePasteText={usePasteText}
              loadDemoDocument={loadDemoDocument}
              rawText={rawText}
              setStep={setStep}
              compareDocuments={compareDocuments}
              compareResult={compareResult}
              compareLoading={compareLoading}
              compareError={compareError}
              compareStatus={compareStatus}
              processCompareFile={processCompareFile}
              handleCompareFileChange={handleCompareFileChange}
              changeCompareText={changeCompareText}
              toggleComparePaste={toggleComparePaste}
              setComparePasteDraft={setComparePasteDraft}
              acceptComparePaste={acceptComparePaste}
              compareInputRevision={compareInputRevision}
              compareDocumentsNow={compareDocumentsNow}
              cancelCompareRequest={cancelCompareRequest}
              compareSpeechState={compareSpeechState}
              compareSpeechAvailable={compareSpeechAvailable}
              startCompareSpeech={startCompareSpeech}
              pauseCompareSpeech={pauseCompareSpeech}
              resumeCompareSpeech={resumeCompareSpeech}
              stopCompareSpeech={stopCompareSpeech}
              highContrast={highContrast}
              largeText={largeText}
            />
          )}

          {step === "review" && (
            <ReviewScreen
              rawText={rawText}
              maskedText={maskedText}
              protectedCount={protectedCount}
              protectEnabled={protectEnabled}
              setProtectEnabled={setProtectEnabled}
              showProtectedModal={showProtectedModal}
              setShowProtectedModal={setShowProtectedModal}
              simplifyDocument={simplifyDocument}
              analysisLoading={analysisLoading}
              onBack={() => setStep("upload")}
              cardClass={cardClass}
            />
          )}

          {step === "understand" && (
            <UnderstandScreen
              analysis={analysis}
              safetyResult={safetyResult}
              safetyLoading={safetyLoading}
              safetyError={safetyError}
              retrySafetyCheck={retrySafetyCheck}
              criticalDetails={criticalDetails}
              explanationText={explanationText}
              rawText={rawText}
              viewMode={viewMode}
              setViewMode={setViewMode}
              readingLevel={readingLevel}
              setReadingLevel={setReadingLevel}
              language={language}
              setLanguage={setLanguage}
              onDocumentLanguageChange={onDocumentLanguageChange}
              onDocumentReadingLevelChange={onDocumentReadingLevelChange}
              displayText={displayText}
              unclearSections={unclearSections}
              speakText={speakText}
              pauseSpeech={pauseSpeech}
              stopSpeech={stopSpeech}
              isSpeaking={isSpeaking}
              isPaused={isPaused}
              onAsk={() => setStep("questions")}
              cardClass={cardClass}
              highContrast={highContrast}
              largeText={largeText}
            />
          )}

          {step === "questions" && (
            <QuestionsScreen
              question={question}
              setQuestion={setQuestion}
              answer={answer}
              questionLoading={questionLoading}
              askQuestion={askQuestion}
              cardClass={cardClass}
              suggestions={DEMO_QUESTIONS}
            />
          )}

          {step === "settings" && (
            <SettingsScreen
              largeText={currentLargeText}
              highContrast={highContrast}
              language={language}
              setLargeText={setLargeText}
              setHighContrast={setHighContrast}
              setLanguage={setLanguage}
              clearSession={clearSession}
            />
          )}
        </main>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* UPLOAD                                                                     */
/* -------------------------------------------------------------------------- */

function UploadScreen({
  file,
  fileLoading,
  pasteMode,
  setPasteMode,
  pasteText,
  setPasteText,
  isDragging,
  setIsDragging,
  fileInputRef,
  handleFileChange,
  handleDrop,
  usePasteText,
  loadDemoDocument,
  rawText,
  setStep,
  compareDocuments,
  compareResult,
  compareLoading,
  compareError,
  compareStatus,
  processCompareFile,
  handleCompareFileChange,
  changeCompareText,
  toggleComparePaste,
  setComparePasteDraft,
  acceptComparePaste,
  compareInputRevision,
  compareDocumentsNow,
  cancelCompareRequest,
  compareSpeechState,
  compareSpeechAvailable,
  startCompareSpeech,
  pauseCompareSpeech,
  resumeCompareSpeech,
  stopCompareSpeech,
  highContrast,
  largeText,
}: any) {
  return (
    <div>
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#155e5a]">
            01 · UPLOAD
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Your document
          </h1>
          <p className="mt-1 text-sm text-[#71807d]">
            Upload a document to get started.
          </p>
        </div>

        <button
          onClick={loadDemoDocument}
          className="w-fit rounded-lg border border-[#d7dfdd] bg-white px-3 py-2 text-xs font-semibold text-[#536763] hover:border-[#155e5a] hover:text-[#155e5a]"
        >
          Use demo document
        </button>
      </div>

      {!pasteMode ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`rounded-[22px] border-2 border-dashed p-6 transition sm:p-10 ${
            isDragging
              ? "border-[#155e5a] bg-[#edf7f5]"
              : "border-[#ccd8d5] bg-white"
          }`}
        >
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#edf7f5] text-[#155e5a]">
              <Icon name="upload" size={25} />
            </div>

            <h2 className="text-lg font-semibold">
              Drag & drop your document here
            </h2>

            <p className="mt-1 text-sm text-[#788683]">
              or choose a file from your device
            </p>

            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={fileLoading}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#155e5a] px-5 py-3 font-semibold text-white hover:bg-[#104d4a] disabled:cursor-wait disabled:opacity-60"
              >
                <Icon name="upload" size={17} />
                {fileLoading ? "Reading..." : "Choose Document"}
              </button>

              <button
                type="button"
                onClick={() => setPasteMode(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#d2dcda] bg-white px-5 py-3 font-semibold text-[#35524e] hover:border-[#155e5a]"
              >
                <Icon name="paste" size={17} />
                Paste Text
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#d2dcda] bg-white px-5 py-3 font-semibold text-[#35524e] sm:hidden"
              >
                Take a Photo
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.txt,.md,.docx,application/pdf,image/png,image/jpeg,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleFileChange}
            />

            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-[#7a8885]">
              <span>PDF</span>
              <span>·</span>
              <span>PNG</span>
              <span>·</span>
              <span>JPG</span>
              <span>·</span>
              <span>DOCX</span>
            </div>

            <div className="mx-auto mt-6 flex max-w-lg items-start gap-3 rounded-xl bg-[#f5f8f7] p-3 text-left">
              <div className="mt-0.5 text-[#155e5a]">
                <Icon name="shield" size={17} />
              </div>

              <div>
                <div className="text-xs font-semibold text-[#34524e]">
                  Protected workflow
                </div>
                <div className="mt-0.5 text-xs leading-5 text-[#74827f]">
                  ClearDoc masks common sensitive information before sending
                  protected text to AI.
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[22px] border border-[#dfe6e3] bg-white p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#155e5a]">
                PASTE TEXT
              </div>
              <h2 className="mt-1 text-xl font-semibold">
                Paste your document text
              </h2>
            </div>

            <button
              onClick={() => setPasteMode(false)}
              className="rounded-lg p-2 text-[#657571] hover:bg-[#f3f6f5]"
              aria-label="Close paste text"
            >
              <Icon name="close" size={18} />
            </button>
          </div>

          <textarea
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder="Paste the text from your document here..."
            className="mt-5 min-h-[300px] w-full resize-y rounded-xl border border-[#d5dfdc] bg-[#fbfcfb] p-4 text-sm leading-6 outline-none focus:border-[#155e5a] focus:ring-2 focus:ring-[#155e5a]/10"
            aria-label="Paste document text"
          />

          <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              onClick={() => {
                setPasteMode(false);
                setPasteText("");
              }}
              className="rounded-xl border border-[#d5dfdc] bg-white px-4 py-2.5 font-semibold text-[#536763]"
            >
              Cancel
            </button>

            <button
              onClick={usePasteText}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#155e5a] px-4 py-2.5 font-semibold text-white"
            >
              Use This Text
              <Icon name="arrow" size={16} />
            </button>
          </div>
        </div>
      )}

      {rawText && !pasteMode && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-[#dfe6e3] bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#eef5f3] text-[#155e5a]">
              <Icon name="document" size={18} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {file?.name || "Pasted document"}
              </div>
              <div className="text-xs text-[#778683]">
                Document text extracted successfully
              </div>
            </div>
          </div>

          <button
            onClick={() => setStep("review")}
            className="hidden rounded-lg bg-[#155e5a] px-3 py-2 text-xs font-semibold text-white sm:block"
          >
            Review →
          </button>
        </div>
      )}

      <section className="mt-10 border-t border-[#dfe6e3] pt-8" aria-labelledby="compare-title">
        <div className="mb-5">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#155e5a]">COMPARE DOCUMENTS</div>
          <h2 id="compare-title" className="mt-1 text-2xl font-semibold">Did this document change?</h2>
          <p className="mt-1 text-sm text-[#71807d]">Upload an older version and the latest version to see what changed.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {(["previous", "current"] as const).map((version) => {
            const document = compareDocuments[version] as CompareDocument;
            const label = version === "previous" ? "PREVIOUS VERSION" : "CURRENT VERSION";
            return (
              <section key={version} aria-label={`${label} document`} className={`rounded-2xl border p-4 sm:p-5 ${highContrast ? "border-white/50 bg-black" : "border-[#dfe6e3] bg-white"}`}>
                <h3 className="text-sm font-bold tracking-wide">{label}</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => window.document.getElementById(`compare-image-${version}`)?.click()} disabled={document.loading} className="rounded-lg bg-[#155e5a] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                    Upload Image
                  </button>
                  <button type="button" onClick={() => toggleComparePaste(version)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d2dcda] px-3 py-2 text-sm font-semibold">
                    <Icon name="paste" size={16} /> Paste Text
                  </button>
                  <input
                    key={`image-${version}-${compareInputRevision[version]}`}
                    id={`compare-image-${version}`}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    aria-label={`Upload ${version} version image`}
                    onChange={(event) => handleCompareFileChange(version, event)}
                  />
                </div>

                {document.loading && <div className="mt-3 text-sm font-medium text-[#155e5a]" role="status" aria-live="polite">Reading {version} document with OCR...</div>}

                {document.pasteOpen && (
                  <div className="mt-3">
                    <label htmlFor={`paste-${version}`} className="text-sm font-semibold">Paste document text</label>
                    <textarea id={`paste-${version}`} value={document.pasteDraft} onChange={(event) => setComparePasteDraft(version, event.target.value)} className={`mt-1 min-h-28 w-full rounded-lg border p-3 text-sm ${highContrast ? "border-white bg-black text-white" : "border-[#d5dfdc] bg-[#fbfcfb]"}`} />
                    <button type="button" onClick={() => acceptComparePaste(version)} className="mt-2 rounded-lg bg-[#155e5a] px-3 py-2 text-sm font-semibold text-white">Use pasted text</button>
                  </div>
                )}

                <label htmlFor={`text-${version}`} className="mt-4 block text-sm font-semibold">Extracted text (editable)</label>
                <textarea
                  id={`text-${version}`}
                  value={document.text}
                  onChange={(event) => changeCompareText(version, event.target.value)}
                  placeholder="Extracted document text will appear here..."
                  className={`mt-1 min-h-40 w-full rounded-lg border p-3 text-sm leading-6 ${highContrast ? "border-white bg-black text-white placeholder:text-gray-300" : "border-[#d5dfdc] bg-[#fbfcfb]"}`}
                />

                <section className={`mt-3 rounded-lg border p-3 ${highContrast ? "border-white/50 bg-black" : "border-[#cddfd9] bg-[#f3f8f6]"}`} aria-label={`${version === "previous" ? "Previous" : "Current"} what was sent to AI`}>
                  <h4 className="text-sm font-semibold">{version === "previous" ? "Previous" : "Current"} - What was sent to AI</h4>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5">{document.maskedText || "Masked text will appear here."}</pre>
                </section>
              </section>
            );
          })}
        </div>

        {compareError && <div className="mt-4 rounded-lg border border-[#e7cfd3] bg-[#fff6f7] px-4 py-3 text-sm text-[#7d4e56]" role="alert">{compareError}</div>}
        <button type="button" onClick={compareDocumentsNow} disabled={!compareDocuments.previous.text.trim() || !compareDocuments.current.text.trim() || compareLoading} className="mt-4 rounded-xl bg-[#155e5a] px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {compareLoading ? "Comparing documents..." : "Compare"}
        </button>
        {compareLoading && <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className={`${largeText ? "text-base" : "text-sm"} font-medium`} role="status" aria-live="polite">Comparing the masked document text...</p>
          <button type="button" onClick={cancelCompareRequest} aria-label="Cancel comparison" className={`min-h-11 rounded-lg border px-3 py-2 ${largeText ? "text-base" : "text-sm"} font-semibold ${highContrast ? "border-white text-white" : "border-[#d2dcda] bg-white text-[#35524e]"}`}>Cancel</button>
        </div>}
        {compareStatus && <p className="mt-3 text-sm font-medium" role="status" aria-live="polite">{compareStatus}</p>}
        {compareResult && <CompareResultCards
          result={compareResult}
          highContrast={highContrast}
          speechState={compareSpeechState}
          speechAvailable={compareSpeechAvailable}
          onRead={startCompareSpeech}
          onPause={pauseCompareSpeech}
          onResume={resumeCompareSpeech}
          onStop={stopCompareSpeech}
          largeText={largeText}
        />}
      </section>
    </div>
  );
}

function CompareResultCards({ result, highContrast, largeText, speechState, speechAvailable, onRead, onPause, onResume, onStop }: {
  result: CompareResult;
  highContrast: boolean;
  largeText: boolean;
  speechState: CompareSpeechState;
  speechAvailable: boolean;
  onRead: (text: string) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  useEffect(() => () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const badgeColor: Record<string, string> = {
    "No major change": "bg-green-100 text-green-900",
    "Minor changes": "bg-blue-100 text-blue-900",
    "Important changes": "bg-orange-100 text-orange-950",
    "Critical changes": "bg-red-100 text-red-900",
  };
  const hasDifferences = Boolean(
    result.summary || result.added.length || result.removed.length ||
    result.changed_values.length || result.changed_deadlines.length ||
    result.changed_actions.length || result.other_differences.length ||
    result.pay_attention.length
  );
  const card = `rounded-xl border p-4 ${highContrast ? "border-white/50 bg-black" : "border-[#dfe6e3] bg-white"}`;
  const speechButton = `inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 ${largeText ? "text-base" : "text-sm"} font-semibold ${highContrast ? "border-white text-white" : "border-[#d2dcda] bg-white text-[#35524e]"}`;
  const renderDifferenceRows = (title: string, rows: CompareResult["changed_values"], icon?: string) => rows.length ? (
    <section className={card} aria-label={title}>
      <h3 className="flex items-center gap-2 font-semibold">{icon && <Icon name={icon} size={18} />}{title}</h3>
      <ul className="mt-3 space-y-3">
        {rows.map((row, index) => <li key={`${row.item}-${index}`} className="text-sm leading-6">
          <span className="font-semibold">{row.item}: </span><span className="line-through">{row.previous || "Not stated"}</span><span aria-hidden="true"> → </span><span>{row.current || "Not stated"}</span>
        </li>)}
      </ul>
    </section>
  ) : null;

  if (!hasDifferences) return <p className={`mt-5 ${card}`} role="status">No meaningful differences found.</p>;
  const speechText = [result.summary, ...result.pay_attention].filter(Boolean).join(". ");

  return (
    <div className="mt-5 space-y-3" aria-label="Document comparison results">
      {result.summary && <section className={card} aria-label="Comparison summary">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Summary</h3>
          <span className={`rounded-md px-2.5 py-1 text-sm font-bold ${badgeColor[result.change_level] || badgeColor["No major change"]}`}>{result.change_level}</span>
        </div>
        <p className="mt-3 leading-7">{result.summary}</p>
        {speechAvailable && <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Read comparison aloud">
          {speechState === "idle" && <button type="button" onClick={() => onRead(speechText)} aria-label="Read comparison aloud" className={speechButton}>
            <Icon name="volume" size={17} /> Read Aloud
          </button>}
          {speechState === "speaking" && <>
            <button type="button" onClick={onPause} aria-label="Pause reading" className={speechButton}>Pause</button>
            <button type="button" onClick={onStop} aria-label="Stop reading" className={speechButton}>Stop</button>
          </>}
          {speechState === "paused" && <>
            <button type="button" onClick={onResume} aria-label="Resume reading" className={speechButton}>Resume</button>
            <button type="button" onClick={onStop} aria-label="Stop reading" className={speechButton}>Stop</button>
          </>}
          <span className="sr-only" role="status" aria-live="polite">
            {speechState === "speaking" ? "Reading aloud" : speechState === "paused" ? "Reading paused" : ""}
          </span>
        </div>}
      </section>}

      {result.pay_attention.length > 0 && <section className={`rounded-xl border-2 p-4 ${highContrast ? "border-white bg-black" : "border-[#d9a64a] bg-[#fff8e8]"}`} aria-label="Pay attention to">
        <h3 className="font-semibold">Pay attention to</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">{result.pay_attention.map((item: string, index: number) => <li key={index}>{item}</li>)}</ul>
      </section>}

      {result.added.length > 0 && <section className={card} aria-label="What was added"><h3 className="font-semibold">What was added</h3><ul className="mt-2 space-y-1">{result.added.map((item: string, index: number) => <li key={index} className="flex gap-2"><span className="font-bold text-green-700" aria-hidden="true">+</span><span>{item}</span></li>)}</ul></section>}
      {result.removed.length > 0 && <section className={card} aria-label="What was removed"><h3 className="font-semibold">What was removed</h3><ul className="mt-2 space-y-1">{result.removed.map((item: string, index: number) => <li key={index} className="flex gap-2"><span className="font-bold text-red-700" aria-hidden="true">−</span><span>{item}</span></li>)}</ul></section>}
      {renderDifferenceRows("Values that changed", result.changed_values)}
      {renderDifferenceRows("Deadlines that changed", result.changed_deadlines, "calendar")}
      {renderDifferenceRows("Actions that changed", result.changed_actions, "check")}
      {result.other_differences.length > 0 && <section className={card} aria-label="Other differences"><h3 className="font-semibold">Other differences</h3><ul className="mt-2 list-disc space-y-1 pl-5">{result.other_differences.map((item: string, index: number) => <li key={index}>{item}</li>)}</ul></section>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* REVIEW                                                                     */
/* -------------------------------------------------------------------------- */

function ReviewScreen({
  rawText,
  maskedText,
  protectedCount,
  protectEnabled,
  setProtectEnabled,
  showProtectedModal,
  setShowProtectedModal,
  simplifyDocument,
  analysisLoading,
  onBack,
}: any) {
  return (
    <div>
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#155e5a]">
            02 · REVIEW & PROTECT
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Review & Protect
          </h1>
          <p className="mt-1 text-sm text-[#71807d]">
            Check what information will be shared with AI.
          </p>
        </div>

        <button
          onClick={onBack}
          className="w-fit rounded-lg border border-[#d7dfdd] bg-white px-3 py-2 text-xs font-semibold text-[#536763]"
        >
          ← Back to Upload
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DocumentReader
          title="Original Text"
          text={rawText}
          original
        />

        <DocumentReader
          title="Protected Text"
          text={protectEnabled ? maskedText : rawText}
          protectedText={protectEnabled}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="rounded-[18px] border border-[#dfe6e3] bg-white p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.12em] text-[#778783]">
                PRIVACY STATUS
              </div>

              <div className="mt-1 text-lg font-semibold">
                Sensitive information detected
              </div>

              <div className="mt-1 text-sm text-[#71807d]">
                {protectedCount} item
                {protectedCount === 1 ? "" : "s"} protected
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Toggle
                checked={protectEnabled}
                onChange={setProtectEnabled}
                label="Protect sensitive information"
              />

              <div className="text-sm font-semibold">
                Protect sensitive information
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-[#f2f7f5] p-3 text-sm leading-6 text-[#536763]">
            <span className="mr-2 inline-flex text-[#155e5a]">
              <Icon name="shield" size={17} />
            </span>
            Sensitive information is masked before the protected text is sent
            to AI.
          </div>
        </div>

        <div className="flex flex-col justify-center gap-2 sm:flex-row lg:flex-col">
          <button
            onClick={() => setShowProtectedModal(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#d4dfdc] bg-white px-4 py-3 text-sm font-semibold text-[#36534f]"
          >
            <Icon name="eye" size={17} />
            View what was sent to AI
          </button>

          <button
            onClick={simplifyDocument}
            disabled={analysisLoading}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#155e5a] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {analysisLoading ? "Simplifying..." : "Simplify Document"}
            {!analysisLoading && <Icon name="arrow" size={16} />}
          </button>
        </div>
      </div>

      {showProtectedModal && (
        <ProtectedModal
          text={protectEnabled ? maskedText : rawText}
          onClose={() => setShowProtectedModal(false)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* UNDERSTAND                                                                 */
/* -------------------------------------------------------------------------- */

function UnderstandScreen({
  analysis,
  safetyResult,
  safetyLoading,
  safetyError,
  retrySafetyCheck,
  criticalDetails,
  explanationText,
  rawText,
  viewMode,
  setViewMode,
  readingLevel,
  setReadingLevel,
  language,
  setLanguage,
  onDocumentLanguageChange,
  onDocumentReadingLevelChange,
  displayText,
  unclearSections,
  speakText,
  pauseSpeech,
  stopSpeech,
  isSpeaking,
  isPaused,
  onAsk,
  highContrast,
  largeText,
}: any) {
  const demo =
    !analysis ||
    (!explanationText && rawText.includes("₹4,500"));

  const details =
    criticalDetails.length > 0
      ? criticalDetails
      : demo
      ? DEMO_ANALYSIS.critical_details
      : [];

  const explanation =
    explanationText ||
    (demo ? DEMO_ANALYSIS.explanation : "");

  const unclear =
    unclearSections.length > 0
      ? unclearSections
      : demo
      ? DEMO_ANALYSIS.unclear_parts
      : [];

  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const [sectionExplanation, setSectionExplanation] = useState("");
  const [sectionExplainLoading, setSectionExplainLoading] = useState(false);
  const [sectionExplainError, setSectionExplainError] = useState("");
  const documentTextRef = useRef<HTMLDivElement>(null);
  const explainRequestRef = useRef<AbortController | null>(null);
  const explainCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => () => explainRequestRef.current?.abort(), []);

  useEffect(() => {
    if (explainOpen) explainCloseRef.current?.focus();
  }, [explainOpen]);

  useEffect(() => {
    if (!explainOpen) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeSectionExplanation();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [explainOpen]);

  function captureDocumentSelection() {
    const currentSelection = window.getSelection();
    const selectedText = currentSelection?.toString().trim() || "";
    const container = documentTextRef.current;
    if (
      !currentSelection || currentSelection.isCollapsed || !selectedText || !container ||
      !container.contains(currentSelection.anchorNode) ||
      !container.contains(currentSelection.focusNode)
    ) {
      if (!explainOpen) setSelection(null);
      return;
    }

    const bounds = currentSelection.getRangeAt(0).getBoundingClientRect();
    explainRequestRef.current?.abort();
    explainRequestRef.current = null;
    setSectionExplainLoading(false);
    setSelection({
      text: selectedText,
      top: Math.max(8, Math.min(bounds.bottom + 8, window.innerHeight - 56)),
      left: Math.max(8, Math.min(bounds.left, window.innerWidth - 160)),
    });
    setExplainOpen(false);
    setSectionExplanation("");
    setSectionExplainError("");
  }

  function closeSectionExplanation() {
    explainRequestRef.current?.abort();
    explainRequestRef.current = null;
    setExplainOpen(false);
    setSectionExplanation("");
    setSectionExplainError("");
    setSectionExplainLoading(false);
    setSelection(null);
  }

  async function explainSelectedSection() {
    if (!selection?.text.trim()) return;
    explainRequestRef.current?.abort();
    const controller = new AbortController();
    explainRequestRef.current = controller;
    setExplainOpen(true);
    setSectionExplanation("");
    setSectionExplainError("");
    setSectionExplainLoading(true);

    const maskedText = redact(selection.text).masked;
    try {
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          selectedText: maskedText,
          language,
          level: readingLevel.toLowerCase(),
        }),
      });
      const data = await response.json();
      if (!response.ok || typeof data?.explanation !== "string") {
        throw new Error("Unable to explain this section.");
      }
      if (explainRequestRef.current === controller) setSectionExplanation(data.explanation);
    } catch {
      if (!controller.signal.aborted && explainRequestRef.current === controller) {
        setSectionExplainError("Unable to explain this section. Please try again.");
      }
    } finally {
      if (explainRequestRef.current === controller) {
        explainRequestRef.current = null;
        setSectionExplainLoading(false);
      }
    }
  }

  return (
    <div>
      <div className="mb-5">
        <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#155e5a]">
          03 · UNDERSTAND
        </div>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Your document is ready
        </h1>

        <div className="mt-1 flex items-center gap-2 text-sm text-[#71807d]">
          <Icon name="document" size={16} />
          {analysis?.document_type || "Bank Notice"}
        </div>
      </div>

      {/* CRITICAL DETAILS */}
      <div>
        <div className="mb-2 text-sm font-semibold">Critical Details</div>

        <div className="grid gap-3 md:grid-cols-3">
          {details.slice(0, 3).map(
            (
              detail: string | { type?: string; text?: string },
              index: number
            ) => {
              const type =
                typeof detail === "string"
                  ? "Detail"
                  : detail.type || "Detail";

              const text =
                typeof detail === "string"
                  ? detail
                  : detail.text || "";

              let icon = "check";

              if (type.toLowerCase().includes("deadline")) {
                icon = "calendar";
              } else if (type.toLowerCase().includes("amount")) {
                icon = "money";
              } else if (type.toLowerCase().includes("action")) {
                icon = "check";
              }

              return (
                <div
                  key={`${type}-${index}`}
                  className="rounded-[18px] border border-[#dfe6e3] bg-white p-4"
                >
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-[#778783]">
                    <span className="text-[#155e5a]">
                      <Icon name={icon} size={17} />
                    </span>
                    {type}
                  </div>

                  <div className="mt-3 text-lg font-semibold leading-6">
                    {text}
                  </div>
                </div>
              );
            }
          )}

          {details.length === 0 && (
            <>
              <DetailFallback
                icon="calendar"
                label="DEADLINE"
                value="Not specified"
              />
              <DetailFallback
                icon="money"
                label="AMOUNT"
                value="Not specified"
              />
              <DetailFallback
                icon="check"
                label="ACTION"
                value="Review the document"
              />
            </>
          )}
        </div>
      </div>

      <SafetyCheckCard
        result={safetyResult}
        loading={safetyLoading}
        failed={safetyError}
        onRetry={retrySafetyCheck}
        highContrast={highContrast}
        largeText={largeText}
      />

      {/* EXPLANATION */}
      <div className="mt-4 rounded-[20px] border border-[#dfe6e3] bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-xs font-bold uppercase tracking-[0.12em] text-[#155e5a]">
              DOCUMENT SUMMARY
            </div>

            <h2 className="mt-1 text-xl font-semibold">
              What this means
            </h2>

            <p className="mt-3 leading-7 text-[#4f615e]">
              {explanation ||
                "No explanation was returned. You can view the original document below."}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <label className="text-xs font-semibold text-[#71807d]">
              Reading level
            </label>

            <select
              value={readingLevel}
              onChange={(event) =>
                onDocumentReadingLevelChange(
                  event.target.value as ReadingLevel
                )
              }
              className="rounded-lg border border-[#d7dfdd] bg-white px-2.5 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-[#155e5a]"
            >
              <option>Simple</option>
              <option>Standard</option>
              <option>Detailed</option>
            </select>

            <label className="sr-only">Language</label>

            <select
              value={language}
              onChange={(event) =>
                onDocumentLanguageChange(event.target.value as Language)
              }
              className="rounded-lg border border-[#d7dfdd] bg-white px-2.5 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-[#155e5a]"
            >
              <option>English</option>
              <option>Telugu</option>
              <option>Hindi</option>
            </select>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[#edf0ef] pt-4">
          <span className="mr-1 text-xs font-semibold text-[#71807d]">
            Audio
          </span>

          <button
            onClick={() => speakText()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#d7dfdd] bg-white px-3 py-2 text-xs font-semibold text-[#3e5854]"
          >
            <Icon name="volume" size={15} />
            Listen
          </button>

          <button
            onClick={pauseSpeech}
            disabled={!isSpeaking}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#d7dfdd] bg-white px-3 py-2 text-xs font-semibold text-[#3e5854] disabled:opacity-40"
          >
            <Icon name="pause" size={15} />
            {isPaused ? "Paused" : "Pause"}
          </button>

          <button
            onClick={stopSpeech}
            disabled={!isSpeaking && !isPaused}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#d7dfdd] bg-white px-3 py-2 text-xs font-semibold text-[#3e5854] disabled:opacity-40"
          >
            <Icon name="stop" size={15} />
            Stop
          </button>

          {isSpeaking && (
            <span className="text-xs font-medium text-[#155e5a]">
              Reading aloud…
            </span>
          )}
        </div>
      </div>

      {/* SIMPLE / ORIGINAL + UNCLEAR */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
        <div className="rounded-[20px] border border-[#dfe6e3] bg-white p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold">
                Document view
              </div>
              <div className="mt-1 text-xs text-[#778783]">
                Switch between the accessible explanation and the original
                extracted text.
              </div>
            </div>

            <div className="inline-flex w-fit rounded-lg border border-[#d8e0de] bg-[#f6f8f7] p-1">
              <button
                onClick={() => setViewMode("simple")}
                className={`rounded-md px-3 py-2 text-xs font-semibold ${
                  viewMode === "simple"
                    ? "bg-white text-[#155e5a] shadow-sm"
                    : "text-[#687975]"
                }`}
              >
                Simple Explanation
              </button>

              <button
                onClick={() => setViewMode("original")}
                className={`rounded-md px-3 py-2 text-xs font-semibold ${
                  viewMode === "original"
                    ? "bg-white text-[#155e5a] shadow-sm"
                    : "text-[#687975]"
                }`}
              >
                Original Document
              </button>
            </div>
          </div>

          <div
            ref={documentTextRef}
            onMouseUp={captureDocumentSelection}
            onKeyUp={captureDocumentSelection}
            onTouchEnd={captureDocumentSelection}
            tabIndex={0}
            aria-label="Selectable document text"
            className="mt-4 max-h-[280px] overflow-y-auto rounded-xl bg-[#f7f9f8] p-4"
          >
            <p
              className={`select-text whitespace-pre-wrap leading-7 ${
                viewMode === "original"
                  ? "font-mono text-sm text-[#4e605c]"
                  : "text-[#425653]"
              }`}
            >
              {displayText ||
                "No document content is available yet."}
            </p>
          </div>

          {selection && !explainOpen && <button
            type="button"
            onClick={explainSelectedSection}
            aria-label="Explain selected document text"
            className={`fixed z-50 min-h-11 rounded-lg border px-3 py-2 ${largeText ? "text-base" : "text-sm"} font-semibold shadow-md ${highContrast ? "border-white bg-black text-white" : "border-[#155e5a] bg-white text-[#155e5a]"}`}
            style={{ top: selection.top, left: selection.left }}
          >
            Explain this
          </button>}

          {selection && explainOpen && <section
            role="dialog"
            aria-modal="false"
            aria-labelledby="section-explanation-title"
            className={`fixed z-50 max-h-[75vh] overflow-y-auto rounded-xl border p-4 shadow-xl ${highContrast ? "border-white bg-black text-white" : "border-[#dfe6e3] bg-white text-[#18332f]"}`}
            style={{
              top: Math.max(8, Math.min(selection.top, window.innerHeight - 240)),
              left: Math.max(8, Math.min(selection.left, window.innerWidth - 360)),
              width: "min(22rem, calc(100vw - 16px))",
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 id="section-explanation-title" className={`${largeText ? "text-lg" : "text-base"} font-semibold`}>Simple explanation</h3>
              <button
                ref={explainCloseRef}
                type="button"
                onClick={closeSectionExplanation}
                aria-label="Close section explanation"
                className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg border ${highContrast ? "border-white text-white" : "border-[#d7dfdd] text-[#3e5854]"}`}
              >
                <Icon name="close" size={17} />
              </button>
            </div>
            {sectionExplainLoading && <p className={`mt-3 ${largeText ? "text-base" : "text-sm"} leading-6`} role="status" aria-live="polite">Understanding this section...</p>}
            {sectionExplainError && <div className="mt-3" role="alert">
              <p className={`${largeText ? "text-base" : "text-sm"} leading-6`}>{sectionExplainError}</p>
              <button type="button" onClick={explainSelectedSection} className={`mt-2 min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold ${highContrast ? "border-white text-white" : "border-[#d2dcda] bg-white text-[#35524e]"}`}>Try again</button>
            </div>}
            {sectionExplanation && <p className={`mt-3 whitespace-pre-wrap ${largeText ? "text-base" : "text-sm"} leading-6`} aria-live="polite">{sectionExplanation}</p>}
          </section>}
        </div>

        <div className="rounded-[20px] border border-[#e6dfd7] bg-[#fffaf4] p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f4eadc] text-[#866c47]">
              <Icon name="help" size={17} />
            </div>

            <div>
              <div className="text-sm font-semibold">
                Things that may need clarification
              </div>
              <div className="text-xs text-[#8a7d6d]">
                Areas that may require checking
              </div>
            </div>
          </div>

          {unclear.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {unclear.map((item: string, index: number) => (
                <li
                  key={index}
                  className="flex gap-2 text-sm leading-6 text-[#695e51]"
                >
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#a88659]" />
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-4 rounded-lg bg-white/70 p-3 text-sm text-[#695e51]">
              No unclear sections were found.
            </div>
          )}
        </div>
      </div>

      {/* ASK */}
      <div className="mt-4 rounded-[20px] border border-[#dfe6e3] bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.12em] text-[#155e5a]">
              DOCUMENT Q&A
            </div>

            <h2 className="mt-1 text-lg font-semibold">
              Ask about this document
            </h2>

            <p className="mt-1 text-sm text-[#71807d]">
              Ask a question and ClearDoc will answer using only your
              document.
            </p>
          </div>

          <button
            onClick={onAsk}
            className="inline-flex w-fit items-center gap-2 rounded-xl bg-[#155e5a] px-4 py-2.5 text-sm font-semibold text-white"
          >
            Ask Questions
            <Icon name="arrow" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SafetyCheckCard({ result, loading, failed, onRetry, highContrast, largeText }: {
  result: SafetyResult | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  highContrast: boolean;
  largeText: boolean;
}) {
  if (!loading && !failed && !result) return null;
  const cardClass = `mt-4 rounded-[18px] border p-5 ${highContrast ? "border-white/50 bg-black text-white" : "border-[#dfe6e3] bg-white text-[#18332f]"}`;
  const bodyTextClass = largeText ? "text-base leading-7" : "text-sm leading-6";

  return (
    <section className={cardClass} aria-labelledby="safety-check-title">
      <div className="flex items-center gap-2">
        <span className="text-[#155e5a]"><Icon name="shield" size={19} /></span>
        <h2 id="safety-check-title" className="text-lg font-semibold">Document Safety Check</h2>
      </div>

      {loading && <p className={`mt-3 ${bodyTextClass}`} role="status" aria-live="polite">Checking document for potential risk indicators...</p>}

      {failed && <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className={bodyTextClass} role="status" aria-live="polite">Safety Check temporarily unavailable.</p>
        <button type="button" onClick={onRetry} aria-label="Retry Safety Check" className={`min-h-11 rounded-lg border px-3 py-2 ${largeText ? "text-base" : "text-sm"} font-semibold ${highContrast ? "border-white text-white" : "border-[#d2dcda] bg-white text-[#35524e]"}`}>Retry</button>
      </div>}

      {result && <>
        <div className={`mt-3 font-semibold ${bodyTextClass}`}>
          {result.status === "low_concern"
            ? "✓ No major suspicious signals detected"
            : result.status === "needs_verification"
            ? "⚠ Needs Verification"
            : "⚠ Potential risk indicators detected"}
        </div>

        {result.status === "low_concern" ? (
          <div className={`mt-2 space-y-2 ${bodyTextClass}`}>
            <p>No major risk indicators were found in the document content.</p>
            <p>This does not prove authenticity. Verify important requests through an independently obtained official source.</p>
          </div>
        ) : <p className={`mt-2 ${bodyTextClass}`}>{result.summary || "Some details should be verified before you act."}</p>}

        {result.signals.length > 0 && <div className="mt-4 space-y-3">
          {result.signals.map((signal, index) => {
            const signalColor = highContrast
              ? "border-white/50 bg-black"
              : signal.severity === "high"
              ? "border-[#e6c5c8] bg-[#fff6f7]"
              : signal.severity === "medium"
              ? "border-[#ead7b8] bg-[#fffaf1]"
              : "border-[#d7e2e0] bg-[#f7f9f8]";
            return <article key={`${signal.type}-${index}`} className={`rounded-xl border p-4 ${signalColor}`}>
              <h3 className={`font-semibold ${bodyTextClass}`}>{signal.title}</h3>
              <blockquote className={`mt-2 border-l-2 border-current pl-3 ${bodyTextClass}`}>&ldquo;{signal.evidence}&rdquo;</blockquote>
              <p className={`mt-3 ${bodyTextClass}`}><strong>Why:</strong> {signal.why}</p>
              <p className={`mt-2 ${bodyTextClass}`}><strong>Precaution:</strong> {signal.precaution}</p>
            </article>;
          })}
        </div>}

        {result.before_you_act.length > 0 && <div className="mt-4 border-t border-[#dfe6e3] pt-4">
          <h3 className="font-semibold">Before You Act</h3>
          <ul className={`mt-2 space-y-2 ${bodyTextClass}`}>
            {result.before_you_act.map((item, index) => <li key={index} className="flex gap-2">
              <span className="shrink-0 text-[#155e5a]" aria-hidden="true">✓</span><span>{item}</span>
            </li>)}
          </ul>
        </div>}
        <p className={`mt-4 border-t border-[#dfe6e3] pt-3 ${highContrast ? "text-white" : "text-[#71807d]"} ${bodyTextClass}`}>
          ClearDoc detects risk indicators from document content. It cannot independently confirm whether a document is genuine.
        </p>
      </>}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* QUESTIONS                                                                  */
/* -------------------------------------------------------------------------- */

function QuestionsScreen({
  question,
  setQuestion,
  answer,
  questionLoading,
  askQuestion,
  suggestions,
}: any) {
  return (
    <div>
      <div className="mb-5">
        <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#155e5a]">
          DOCUMENT Q&A
        </div>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Ask about this document
        </h1>

        <p className="mt-1 text-sm text-[#71807d]">
          Ask a question and ClearDoc will answer using only your document.
        </p>
      </div>

      <div className="rounded-[20px] border border-[#dfe6e3] bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void askQuestion();
              }
            }}
            placeholder="What would you like to know?"
            className="min-w-0 flex-1 rounded-xl border border-[#d4dfdc] bg-[#fbfcfb] px-4 py-3 text-sm outline-none focus:border-[#155e5a] focus:ring-2 focus:ring-[#155e5a]/10"
            aria-label="Question about document"
          />

          <button
            onClick={() => void askQuestion()}
            disabled={questionLoading}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#155e5a] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {questionLoading ? "Thinking..." : "Ask"}
            {!questionLoading && <Icon name="arrow" size={16} />}
          </button>
        </div>

        <div className="mt-5">
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-[#7b8986]">
            Suggested questions
          </div>

          <div className="flex flex-wrap gap-2">
            {suggestions.map((item: string) => (
              <button
                key={item}
                onClick={() => void askQuestion(item)}
                className="rounded-lg border border-[#d9e2df] bg-white px-3 py-2 text-xs font-medium text-[#526864] hover:border-[#155e5a] hover:text-[#155e5a]"
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        {answer && (
          <div className="mt-6 rounded-[18px] border border-[#cfe1dc] bg-[#f1f8f6] p-5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[#155e5a]">
              <Icon name="check" size={16} />
              Answer
            </div>

            <p className="mt-3 leading-7 text-[#38534f]">
              {answer}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SETTINGS                                                                   */
/* -------------------------------------------------------------------------- */

function SettingsScreen({
  largeText,
  highContrast,
  language,
  setLargeText,
  setHighContrast,
  setLanguage,
  clearSession,
}: any) {
  return (
    <div>
      <div className="mb-5">
        <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#155e5a]">
          SETTINGS
        </div>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Application settings
        </h1>

        <p className="mt-1 text-sm text-[#71807d]">
          ClearDoc settings apply only to this session.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[20px] border border-[#dfe6e3] bg-white p-5">
          <div className="text-xs font-bold uppercase tracking-[0.12em] text-[#778783]">
            ACCESSIBILITY
          </div>

          <div className="mt-4 divide-y divide-[#edf0ef]">
            <SettingRow
              icon="accessibility"
              title="Large Text"
              description="Increase application typography."
              control={
                <Toggle
                  checked={largeText}
                  onChange={setLargeText}
                  label="Large Text"
                />
              }
            />

            <SettingRow
              icon="shield"
              title="High Contrast"
              description="Use stronger contrast and focus states."
              control={
                <Toggle
                  checked={highContrast}
                  onChange={setHighContrast}
                  label="High Contrast"
                />
              }
            />
          </div>
        </div>

        <div className="rounded-[20px] border border-[#dfe6e3] bg-white p-5">
          <div className="text-xs font-bold uppercase tracking-[0.12em] text-[#778783]">
            LANGUAGE
          </div>

          <div className="mt-4">
            <label className="text-sm font-semibold">
              Interface language
            </label>

            <select
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value)
              }
              className="mt-2 w-full rounded-xl border border-[#d5dfdc] bg-white px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-[#155e5a]"
            >
              <option>English</option>
              <option>Telugu</option>
              <option>Hindi</option>
            </select>
          </div>

          <div className="mt-7 border-t border-[#edf0ef] pt-5">
            <div className="text-xs font-bold uppercase tracking-[0.12em] text-[#778783]">
              DOCUMENT
            </div>

            <button
              onClick={clearSession}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-[#ead4d7] px-4 py-2.5 text-sm font-semibold text-[#8c5960]"
            >
              <Icon name="trash" size={17} />
              Clear Current Session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* COMPONENTS                                                                 */
/* -------------------------------------------------------------------------- */

function StepIndicator({ step }: { step: WorkspaceStep }) {
  const steps = [
    { key: "upload", number: "01", label: "Upload" },
    { key: "review", number: "02", label: "Review & Protect" },
    { key: "understand", number: "03", label: "Understand" },
  ];

  const currentIndex = Math.max(
    0,
    steps.findIndex((item) => item.key === step)
  );

  return (
    <div className="mb-5 overflow-x-auto rounded-xl border border-[#dfe6e3] bg-white p-2">
      <div className="flex min-w-[500px] items-center">
        {steps.map((item, index) => {
          const active = item.key === step;
          const completed = index < currentIndex;

          return (
            <div
              key={item.key}
              className="flex min-w-0 flex-1 items-center"
            >
              <div
                className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
                  active
                    ? "bg-[#edf5f3] text-[#155e5a]"
                    : completed
                    ? "text-[#155e5a]"
                    : "text-[#899692]"
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                    active
                      ? "bg-[#155e5a] text-white"
                      : completed
                      ? "bg-[#dcece8] text-[#155e5a]"
                      : "bg-[#f0f3f2]"
                  }`}
                >
                  {completed ? "✓" : item.number}
                </span>

                <span className="whitespace-nowrap text-xs font-semibold">
                  {item.label}
                </span>
              </div>

              {index < steps.length - 1 && (
                <div className="mx-2 h-px flex-1 bg-[#e2e8e6]" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DocumentReader({
  title,
  text,
  protectedText = false,
  original = false,
}: {
  title: string;
  text: string;
  protectedText?: boolean;
  original?: boolean;
}) {
  const lines = text.split("\n");

  return (
    <div className="overflow-hidden rounded-[20px] border border-[#dfe6e3] bg-white">
      <div className="flex items-center justify-between border-b border-[#edf0ef] px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon
            name={protectedText ? "shield" : "document"}
            size={17}
          />
          <span className="text-sm font-semibold">{title}</span>
        </div>

        <span
          className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${
            protectedText
              ? "bg-[#e7f3f0] text-[#155e5a]"
              : "bg-[#f2f4f3] text-[#74827f]"
          }`}
        >
          {protectedText ? "Protected" : original ? "Original" : "Text"}
        </span>
      </div>

      <div className="max-h-[380px] overflow-y-auto p-5">
        <div className="rounded-xl border border-[#edf0ef] bg-[#fbfcfb] p-4">
          {lines.map((line, index) => {
            const isMasked =
              protectedText &&
              /\[[A-Z]+_\d+\]/.test(line);

            if (!isMasked) {
              return (
                <div
                  key={index}
                  className="min-h-[24px] whitespace-pre-wrap text-sm leading-6 text-[#4e605c]"
                >
                  {line}
                </div>
              );
            }

            const parts = line.split(
              /(\[[A-Z]+_\d+\])/
            );

            return (
              <div
                key={index}
                className="min-h-[24px] whitespace-pre-wrap text-sm leading-6 text-[#4e605c]"
              >
                {parts.map((part, partIndex) =>
                  /^\[[A-Z]+_\d+\]$/.test(part) ? (
                    <span
                      key={partIndex}
                      className="rounded-md border border-[#bcd9d2] bg-[#e8f4f1] px-1.5 py-0.5 font-medium text-[#155e5a]"
                    >
                      {part}
                    </span>
                  ) : (
                    part
                  )
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProtectedModal({
  text,
  onClose,
}: {
  text: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="protected-modal-title"
    >
      <div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-[22px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e5eae8] px-5 py-4">
          <div>
            <div
              id="protected-modal-title"
              className="font-semibold"
            >
              What was sent to AI
            </div>
            <div className="mt-0.5 text-xs text-[#778783]">
              Review before sharing
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#657571] hover:bg-[#f3f6f5]"
            aria-label="Close protected text dialog"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-5">
          <div className="rounded-xl bg-[#f3f8f6] p-4">
            <pre className="whitespace-pre-wrap font-mono text-sm leading-6 text-[#425c57]">
              {text}
            </pre>
          </div>
        </div>

        <div className="flex justify-end border-t border-[#e5eae8] px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-xl bg-[#155e5a] px-4 py-2.5 text-sm font-semibold text-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function AccessibilityPanel({
  highContrast,
  largeText,
  language,
  setHighContrast,
  setLargeText,
  setLanguage,
  onClose,
  onListen,
  onPause,
  onStop,
  isSpeaking,
  isPaused,
}: any) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="accessibility-title"
    >
      <div className="w-full max-w-md rounded-[22px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e6ebe9] px-5 py-4">
          <div>
            <div
              id="accessibility-title"
              className="font-semibold"
            >
              Accessibility
            </div>
            <div className="text-xs text-[#778783]">
              Adjust ClearDoc for easier access.
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#657571] hover:bg-[#f3f6f5]"
            aria-label="Close accessibility panel"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="divide-y divide-[#edf0ef] px-5">
          <SettingRow
            icon="accessibility"
            title="Large Text"
            description="Increase typography and spacing."
            control={
              <Toggle
                checked={largeText}
                onChange={setLargeText}
                label="Large Text"
              />
            }
          />

          <SettingRow
            icon="shield"
            title="High Contrast"
            description="Use strong contrast and visible borders."
            control={
              <Toggle
                checked={highContrast}
                onChange={setHighContrast}
                label="High Contrast"
              />
            }
          />

          <div className="py-4">
            <div className="flex items-center gap-3">
              <div className="text-[#155e5a]">
                <Icon name="language" size={18} />
              </div>

              <div className="flex-1">
                <div className="text-sm font-semibold">Language</div>
                <div className="mt-0.5 text-xs text-[#778783]">
                  Choose the interface and reading language.
                </div>
              </div>

              <select
                value={language}
                onChange={(event) =>
                  setLanguage(event.target.value)
                }
                className="rounded-lg border border-[#d5dfdc] bg-white px-2 py-2 text-xs"
              >
                <option>English</option>
                <option>Telugu</option>
                <option>Hindi</option>
              </select>
            </div>
          </div>

          <div className="py-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="text-[#155e5a]">
                <Icon name="volume" size={18} />
              </div>

              <div>
                <div className="text-sm font-semibold">Read Aloud</div>
                <div className="text-xs text-[#778783]">
                  Use your browser's speech synthesis.
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pl-8">
              <button
                onClick={onListen}
                className="rounded-lg border border-[#d5dfdc] px-3 py-2 text-xs font-semibold"
              >
                Listen
              </button>

              <button
                onClick={onPause}
                disabled={!isSpeaking}
                className="rounded-lg border border-[#d5dfdc] px-3 py-2 text-xs font-semibold disabled:opacity-40"
              >
                {isPaused ? "Paused" : "Pause"}
              </button>

              <button
                onClick={onStop}
                className="rounded-lg border border-[#d5dfdc] px-3 py-2 text-xs font-semibold"
              >
                Stop
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-[#e6ebe9] px-5 py-4">
          <button
            onClick={onClose}
            className="w-full rounded-xl bg-[#155e5a] px-4 py-3 text-sm font-semibold text-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteDialog({
  onCancel,
  onDelete,
}: {
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-title"
    >
      <div className="w-full max-w-md rounded-[22px] bg-white p-6 shadow-2xl">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#fbf1f2] text-[#8c5960]">
          <Icon name="trash" size={20} />
        </div>

        <h2
          id="delete-title"
          className="mt-5 text-xl font-semibold"
        >
          Clear this document?
        </h2>

        <p className="mt-2 text-sm leading-6 text-[#687773]">
          This will clear the current document, protected text, analysis and
          conversation from this session.
        </p>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={onCancel}
            className="rounded-xl border border-[#d5dfdc] bg-white px-4 py-2.5 text-sm font-semibold text-[#526864]"
          >
            Cancel
          </button>

          <button
            onClick={onDelete}
            className="rounded-xl bg-[#8c5960] px-4 py-2.5 text-sm font-semibold text-white"
          >
            Delete Now
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingRow({
  icon,
  title,
  description,
  control,
}: {
  icon: string;
  title: string;
  description: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#eef5f3] text-[#155e5a]">
        <Icon name={icon} size={18} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-xs leading-5 text-[#778783]">
          {description}
        </div>
      </div>

      {control}
    </div>
  );
}

function DetailFallback({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[18px] border border-[#dfe6e3] bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-[#778783]">
        <span className="text-[#155e5a]">
          <Icon name={icon} size={17} />
        </span>
        {label}
      </div>

      <div className="mt-3 text-lg font-semibold leading-6">
        {value}
      </div>
    </div>
  );
}

function BrandFeature({
  icon,
  title,
  text,
}: {
  icon: string;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-[#e5ebe9] bg-[#fbfcfb] p-3">
      <div className="text-[#155e5a]">
        <Icon name={icon} size={16} />
      </div>
      <div className="mt-2 text-xs font-semibold">{title}</div>
      <div className="mt-0.5 text-[10px] text-[#778783]">{text}</div>
    </div>
  );
}

function PhilosophyCard({
  number,
  title,
  text,
  icon,
  className,
}: {
  number: string;
  title: string;
  text: string;
  icon: string;
  className: string;
}) {
  return (
    <div className={`rounded-[20px] border border-[#dfe6e3] p-5 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold tracking-[0.12em] text-[#687975]">
          {number}
        </span>

        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/70 text-[#155e5a]">
          <Icon name={icon} size={18} />
        </div>
      </div>

      <div className="mt-5 text-sm font-bold tracking-[0.12em]">
        {title}
      </div>

      <p className="mt-2 text-sm leading-6 text-[#596b67]">
        {text}
      </p>
    </div>
  );
}

function HowStep({
  number,
  title,
  text,
}: {
  number: string;
  title: string;
  text: string;
}) {
  return (
    <div className="relative rounded-[18px] border border-[#dfe6e3] bg-[#fbfcfb] p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#eaf3f1] text-xs font-bold text-[#155e5a]">
          {number}
        </span>

        <div className="font-semibold">{title}</div>
      </div>

      <p className="mt-3 text-sm leading-6 text-[#6b7a77]">
        {text}
      </p>
    </div>
  );
}

function AccessibilityFeature({
  icon,
  text,
}: {
  icon: string;
  text: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#dce7e4] bg-white p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#edf6f3] text-[#155e5a]">
        <Icon name={icon} size={17} />
      </div>

      <span className="text-sm font-semibold">{text}</span>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-[#155e5a]">
        {eyebrow}
      </div>

      <h2 className="text-3xl font-semibold tracking-tight">
        {title}
      </h2>

      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#71807d]">
        {text}
      </p>
    </div>
  );
}