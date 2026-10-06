import { redact, restore } from "./redact";

const text = `
Aadhaar: 1234 5678 9012
PAN: ABCDE1234F
Email: test@example.com
Phone: 9876543210
Account: 123456789012
`;

const result = redact(text);

console.log("Original:");
console.log(text);

console.log("Masked:");
console.log(result.masked);

console.log("Map:");
console.log(result.map);

console.log("Restored:");
console.log(restore(result.masked, result.map));