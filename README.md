# ClearDoc — Accessible Document Assistant

ClearDoc is an AI-powered accessible document assistant that helps users understand complex documents in simple language while protecting sensitive personal information.

## 🚀 Features

* 📄 **Document Upload** — Upload documents or images for analysis.
* 🔒 **Sensitive Information Protection** — Detect and mask sensitive information such as Aadhaar numbers, PAN numbers, phone numbers, email addresses, and account numbers before sending content to the AI.
* 🤖 **AI Document Simplification** — Convert complex documents into easier-to-understand language.
* 📚 **Reading Levels** — Choose between Simple, Standard, and Detailed explanations.
* 🌐 **Multilingual Support** — Understand documents in English, Hindi, and Telugu.
* 🔊 **Read Aloud** — Listen to simplified document content using text-to-speech.
* 💡 **Key Takeaways** — Quickly understand the most important points.
* ✅ **Action Items** — Identify tasks the user needs to complete.
* ⚠️ **Important Information** — Highlight deadlines, amounts, warnings, and required documents.
* 💬 **Ask Questions** — Ask questions about the uploaded document using an AI-powered Q&A interface.
* 🔄 **Compare Documents** — Compare two documents and identify important differences, changes, deadlines, fees, and requirements.
* 🗑️ **Delete Now** — Remove the current document data from the application.

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

## 🔐 Privacy and Security

Privacy is a core part of ClearDoc.

* Sensitive information can be detected and masked before document content is sent to the AI service.
* Placeholders are used for detected sensitive information to reduce unnecessary exposure of personal identifiers during AI processing.
* Users can review the document and its masked version before proceeding.
* The **Delete Now** option allows users to remove the current document data from the application.
* API keys and other secrets must be stored in environment variables and must never be committed to the repository.

> **Privacy Note:** Masking helps reduce exposure of sensitive information, but automated detection may not identify every sensitive detail. Always review the masked document before processing it.

## 🛠️ Tech Stack

* **Next.js** — Web application framework
* **React** — User interface development
* **TypeScript** — Type-safe JavaScript
* **Groq API** — AI-powered document simplification and question answering
* **Tesseract.js** — Optical Character Recognition (OCR) for extracting text from images
* **Web Speech API** — Text-to-speech functionality
* **CSS / Tailwind CSS** — Styling and responsive design

## 📁 Project Structure

```text
cleardoc/
├── app/                  # Next.js application and routes
├── lib/                  # Utility and document-processing logic
├── public/               # Static assets
├── .env.example          # Example environment variables
├── .gitignore            # Files excluded from Git
├── package.json          # Dependencies and scripts
└── README.md             # Project documentation
```

## ⚙️ Getting Started

Follow these steps to run ClearDoc locally.

### Prerequisites

Make sure you have the following installed:

* [Node.js](https://nodejs.org/)
* npm (included with Node.js)
* A Groq API key

### 1. Clone the Repository

```bash
git clone https://github.com/sawariniparshi/cleardoc-Accessible-Document-Assistant.git
```

### 2. Navigate to the Project Directory

```bash
cd cleardoc-Accessible-Document-Assistant
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env.local` file in the root directory of the project.

Add your Groq API key:

```env
GROQ_API_KEY=your_groq_api_key
```

Replace `your_groq_api_key` with your actual API key.

You can use `.env.example` as a reference if it is available.

**Important:** Never commit `.env.local` or expose your actual API key publicly.

### 5. Start the Development Server

```bash
npm run dev
```

Open the local development URL in your browser:

```text
http://localhost:3000
```

## 🌍 Supported Languages

ClearDoc supports document explanations in:

* 🇬🇧 English
* 🇮🇳 Hindi
* 🇮🇳 Telugu

Language availability may depend on the selected AI model and the implementation of each feature.

## 🎯 Problem We Solve

Important documents often contain complicated terminology, lengthy instructions, deadlines, fees, eligibility requirements, and legal or administrative language.

Understanding these documents can be difficult for students, elderly people, non-native English speakers, and users who need accessible explanations.

ClearDoc aims to make document understanding simpler and more accessible by transforming complex information into clear explanations while keeping privacy in mind.

## 💡 Our Key Idea

ClearDoc brings together three important concepts:

* ♿ **Accessibility** — Make complex information easier to understand.
* 🔒 **Privacy** — Reduce unnecessary exposure of sensitive personal information.
* 🤖 **AI-Powered Understanding** — Explain documents, identify important details, and answer questions.

Together, these capabilities help users understand important documents with greater clarity and confidence.

## 👥 Team

* Garlapadu Ikshitha
* Kilari Aashrika
* Sadagodu Vaishnavi
* Parshi Sawarini

## 🔮 Future Improvements

* Support for additional document formats
* More Indian languages
* Improved document comparison
* Better OCR accuracy for complex documents
* Enhanced accessibility features
* Persistent document history with user-controlled storage
* Improved sensitive-information detection
* More customizable reading and explanation options

---

**ClearDoc — Accessibility + Privacy + AI Document Understanding**

*Making complex documents easier to understand, one page at a time.*
