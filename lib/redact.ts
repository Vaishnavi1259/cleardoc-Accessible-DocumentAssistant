export type RedactionResult = {
  masked: string;
  map: Record<string, string>;
};

export function redact(text: string): RedactionResult {
  const map: Record<string, string> = {};

  const counters: Record<string, number> = {
    AADHAAR: 0,
    PAN: 0,
    EMAIL: 0,
    PHONE: 0,
    ACCOUNT: 0,
  };

  function replaceMatches(
    input: string,
    regex: RegExp,
    type: keyof typeof counters
  ) {
    return input.replace(regex, (match) => {
      counters[type]++;

      const placeholder = `[${type}_${counters[type]}]`;

      map[placeholder] = match;

      return placeholder;
    });
  }

  // Matches Aadhaar numbers with or without spaces.
  text = replaceMatches(
    text,
    /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    "AADHAAR"
  );

  // Matches Indian PAN numbers.
  text = replaceMatches(
    text,
    /\b[A-Z]{5}\d{4}[A-Z]\b/gi,
    "PAN"
  );

  // Matches email addresses.
  text = replaceMatches(
    text,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "EMAIL"
  );

  // Matches Indian phone numbers.
  text = replaceMatches(
    text,
    /(?:\+91[\s-]?)?[6-9]\d{9}\b/g,
    "PHONE"
  );

  // Matches remaining standalone 9-18 digit numbers.
  text = replaceMatches(
    text,
    /\b\d{9,18}\b/g,
    "ACCOUNT"
  );

  return {
    masked: text,
    map,
  };
}

export function restore(
  text: string | undefined,
  map: Record<string, string>
) {
  if (!text) return "";

  let restored = text;

  for (const [placeholder, original] of Object.entries(map)) {
    restored = restored.split(placeholder).join(original);
  }

  return restored;
}