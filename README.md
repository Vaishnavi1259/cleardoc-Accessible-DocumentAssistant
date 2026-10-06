# ClearDoc — Accessible Document Assistant

ClearDoc is an AI-powered accessible document assistant that helps users understand complex documents in simple language while protecting sensitive personal information.

## 🚀 Features

- 📄 **Document Upload** — Upload documents or images for analysis.
- 🔒 **Sensitive Information Protection** — Detect and mask sensitive information such as Aadhaar numbers, PAN numbers, phone numbers, email addresses, and account numbers before sending content to the AI.
- 🤖 **AI Document Simplification** — Convert complex documents into easier-to-understand language.
- 📚 **Reading Levels** — Choose between Simple, Standard, and Detailed explanations.
- 🌐 **Multilingual Support** — Understand documents in English, Hindi, and Telugu.
- 🔊 **Read Aloud** — Listen to simplified document content using text-to-speech.
- 💡 **Key Takeaways** — Quickly understand the most important points.
- ✅ **Action Items** — Identify tasks the user needs to complete.
- ⚠️ **Important Information** — Highlight deadlines, amounts, warnings, and required documents.
- 💬 **Ask Questions** — Ask questions about the uploaded document using an AI-powered Q&A interface.
- 🔄 **Compare Documents** — Compare two applications or documents and identify important differences, changes, deadlines, fees, and requirements.
- 🗑️ **Delete Now** — Remove the current document data from the application.

## 🔄 How ClearDoc Works

```text
Upload Document
       ↓
Review & Protect
       ↓
Mask Sensitive Information
       ↓
Understand
       ↓
AI Simplification
       ↓
Key Information & Takeaways
       ↓
Read Aloud / Translate
       ↓
Ask Questions
       ↓
Compare Documents
```

## 🔐 Privacy

Privacy is a core part of ClearDoc.

Sensitive information can be masked before document content is sent to the AI service. The application uses placeholders for detected sensitive information so that personal identifiers are not unnecessarily exposed during AI processing.

Users can also delete the current document data using the **Delete Now** option.

> Never add your actual API keys or secrets to this repository.

## 🛠️ Tech Stack

- **Next.js**
- **React**
- **TypeScript**
- **Groq API**
- **Tesseract.js**
- **Web Speech API**
- **CSS / Tailwind CSS** (as used in the project)

## 📁 Project Structure

```text
cleardoc/
├── app/                  # Next.js application
├── lib/                  # Utility and document-processing logic
├── public/               # Public assets
├── .env.example          # Example environment variables
├── .gitignore            # Files excluded from Git
├── package.json          # Project dependencies and scripts
└── README.md             # Project documentation
```

## ⚙️ Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/sawariniparshi/cleardoc-Accessible-Document-Assistant.git
```

### 2. Open the project

```bash
cd cleardoc-Accessible-Document-Assistant
```

### 3. Install dependencies

```bash
npm install
```

### 4. Create environment variables

Create a `.env.local` file in the project root.

```env
GROQ_API_KEY=your_groq_api_key
```

You can use `.env.example` as a reference.

**Do not commit `.env.local` or your actual API key to GitHub.**

### 5. Start the development server

```bash
npm run dev
```

Open the local development URL shown in the terminal, usually:

```text
http://localhost:3000
```

## 🌍 Supported Languages

ClearDoc currently supports:

- English
- Hindi
- Telugu

## 🎯 Problem We Solve

Many important documents contain complicated terminology, long instructions, deadlines, fees, eligibility requirements, and legal or administrative language.

ClearDoc aims to make these documents easier to understand while keeping privacy and accessibility in mind.

## 💡 Key Idea

ClearDoc combines:

**Accessibility + Privacy + AI Document Understanding**

into one workflow so that users can understand important documents without having to interpret complex language on their own.


## 👥 Team

Add your team members here:

- Garlapadu Ikshitha
- Kilari Aashrika
- Sadagodu Vaishnavi
- Parshi Sawarini

## 📌 Future Improvements

- Support for additional document formats
- More Indian languages
- Improved document comparison
- Better OCR for complex documents
- Enhanced accessibility features
- Persistent document history with user-controlled storage