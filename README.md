# AI Technical Interviewer

A comprehensive AI-powered technical interview platform that conducts real-time interviews with candidates, featuring voice interaction, code assessment, behavioral monitoring, and automated result generation for recruiters.

## 🌟 Features

### Core Interview Capabilities
- **AI-Powered Interviews**: GPT-4 driven conversational interviews tailored to candidate profiles
- **Real-time Voice Interaction**: Speech-to-text and text-to-speech for natural conversation flow
- **Live Coding Assessment**: Integrated code editor with multiple programming language support
- **Behavioral Monitoring**: Face detection and object detection to ensure interview integrity

### Interview Management
- **Session Scheduling**: Schedule interviews with email notifications
- **Candidate Profiles**: Upload and manage detailed candidate profiles with skills, projects, and experience
- **Custom Questions**: Generate AI-tailored questions based on candidate background
- **Interview Results**: Automated transcription, AI-refined summaries, and recruiter-friendly reports

### Technical Monitoring
- **Video Surveillance**: Real-time face and object detection during interviews
- **Code Editor Integration**: Live coding exercises with test case validation
- **Session Recording**: Complete interview transcripts and coding submissions
- **Email Integration**: Automated notifications using Resend API

## 📸 Platform Screenshots

<div align="center">

### 🏢 Job Portal for Recruiters & Candidates
<table>
<tr>
<td>
<a href="https://ai-technical-interviewer-seven.vercel.app/">
<img src="./Images/job portal for recruiter and candidate.png" alt="Job Portal" width="800"/>
</a>
</td>
</tr>
</table>
<em>Comprehensive job portal with role-based access for both recruiters and candidates</em>

### 👥 Candidate Shortlisting Process
<table>
<tr>
<td>
<img src="./Images/Candidate shortlisting.png" alt="Candidate Shortlisting" width="800"/>
</td>
</tr>
</table>
<em>AI-powered candidate evaluation and shortlisting based on skills and experience</em>

### 📅 AI Interview Scheduler
<table>
<tr>
<td>
<a href="https://ai-interview-caller.vercel.app/">
<img src="./Images/Ai-interview scheduler.png" alt="Interview Scheduler" width="800"/>
</a>
</td>
</tr>
</table>
<em>Intelligent interview scheduling with automated calendar integration</em>

### 📋 Interview Scheduling Process
<table>
<tr>
<td>
<img src="./Images/Interview Scheduling process.png" alt="Interview Scheduling Process" width="800"/>
</td>
</tr>
</table>
<em>Step-by-step interview scheduling workflow with email notifications</em>

### 🚪 Candidate Entry for Interview Session
<table>
<tr>
<td>
<img src="./Images/candidate entry for interview session.png" alt="Candidate Entry" width="800"/>
</td>
</tr>
</table>
<em>Secure candidate authentication and interview session access portal</em>

### 🤖 AI Interviewer for Candidates
<table>
<tr>
<td>
<img src="./Images/Ai-interviewer for candidate.png" alt="AI Interviewer" width="800"/>
</td>
</tr>
</table>
<em>Interactive AI-powered interview interface with real-time conversation</em>

### 💻 AI-Powered Coding Assessment
<table>
<tr>
<td>
<a href="https://ai-technical-interviewer.vercel.app/">
<img src="./Images/Ai powered coding assesment.png" alt="Coding Assessment" width="800"/>
</a>
</td>
</tr>
</table>
<em>Advanced coding challenges with real-time evaluation and feedback</em>

### 🔍 AI Powered Candidate Project Code Analysis
<table>
<tr>
<td>
<img src="./Images/candidate project code AI analysis.png" alt="Code Analysis" width="800"/>
</td>
</tr>
</table>
<em>Intelligent code analysis and technical skill assessment</em>

</div>

## 🚀 Tech Stack

### Backend
- **Node.js** with **Express.js** - RESTful API server
- **OpenAI GPT-4** - AI interview conductor
- **MongoDB** with **Mongoose** - Database for profiles and results
- **Resend** - Email service for notifications
- **CORS** - Cross-origin resource sharing

### Frontend
- **React 19** - Modern UI framework
- **Vite** - Fast build tool and development server
- **TailwindCSS** - Utility-first CSS framework
- **Three.js** with **@react-three/fiber** - 3D avatar rendering
- **MediaPipe** - Face detection capabilities
- **TensorFlow.js** - Object detection models
- **Lucide React** - Modern icon library

## 📋 Prerequisites

- **Node.js** (v16 or higher)
- **npm** or **yarn**
- **MongoDB** (optional - falls back to filesystem storage)
- **OpenAI API Key**
- **Resend API Key** (for email features)

## 🛠️ Installation

### 1. Install Dependencies
```bash
# Install all dependencies (frontend and backend)
cd backend && npm run setup
```

Or install separately:
```bash
# Backend dependencies
cd backend
npm install

# Frontend dependencies
cd ../frontend
npm install
```

### 2. Environment Configuration

Copy the environment template:
```bash
cd backend
cp .env.example .env
```

Configure your `.env` file:
```env
# OpenAI API Configuration (Required)
OPENAI_API_KEY=your_openai_api_key_here

# Email Configuration (Optional)
RESEND_API_KEY=your_resend_api_key_here
FROM_EMAIL=noreply@yourcompany.com

# MongoDB Configuration (Optional - uses filesystem if omitted)
MONGO_URI=mongodb://localhost:27017/ai_interviewer
MONGO_DB_NAME=ai_interviewer

# Frontend URLs
FRONTEND_URL=http://localhost:5173
PRODUCTION_FRONTEND_URL=https://your-production-url.com

# Server Configuration
PORT=3000
```

### 4. Start the Application

**Development Mode (Both servers):**
```bash
cd backend
npm run dev:full
```

**Start Individually:**
```bash
# Backend server
cd backend
npm run dev

# Frontend development server (in new terminal)
cd frontend
npm run dev
```

## 🎯 Usage Guide

### For Recruiters

#### 1. Candidate Profile Management
- Upload candidate profiles via JSON files
- Create detailed profiles with skills, experience, and project details
- Generate AI-tailored interview questions automatically

#### 2. Interview Setup
- Schedule interviews with automatic email notifications
- Configure custom questions and coding challenges
- Set interview parameters (duration, difficulty level)

#### 3. Session Management
- Access live interviews for monitoring
- Review real-time candidate performance
- Export interview results and assessments

### For Candidates

#### 1. Interview Access
- Join interviews using session ID and access token
- Complete pre-interview setup and equipment checks
- Participate in voice-based technical discussions

#### 2. Coding Assessments
- Solve programming challenges in integrated code editor
- Multiple language support (JavaScript, Python, Java, etc.)
- Real-time code execution and test validation

#### 3. Behavioral Monitoring
- Face detection ensures candidate presence
- Object detection maintains interview integrity
- 3D avatar provides engaging interview experience

## 🏗️ Project Structure

```
AI-Interviewer/
├── backend/
│   ├── models/
│   │   └── InterviewSession.js    # MongoDB schema for sessions
│   ├── routes/
│   │   ├── sessions.js            # Interview session routes
│   │   ├── email.js               # Email notification routes
│   │   ├── integrations.js        # External integrations
│   │   └── scheduledSessions.js   # Session scheduling
│   ├── utils/
│   │   ├── emailService.js        # Email service utilities
│   │   └── sessionScheduler.js    # Session scheduling logic
│   ├── candidate-profiles/        # Candidate profile storage
│   ├── interview-results/         # Interview result storage
│   ├── server.js                  # Main server file
│   ├── package.json               # Backend dependencies
│   └── .env.example               # Environment template
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── InterviewSession.jsx    # Main interview interface
│   │   │   ├── AIAvatar3D.jsx          # 3D avatar component
│   │   │   ├── FaceDetector.jsx        # Face detection monitoring
│   │   │   ├── ObjectDetector.jsx      # Object detection monitoring
│   │   │   ├── VideoMonitor.jsx        # Video monitoring panel
│   │   │   ├── MonitoringPanel.jsx     # Behavioral monitoring
│   │   │   └── SessionScheduler.jsx    # Interview scheduling
│   │   ├── pages/
│   │   │   ├── HomePage.jsx            # Landing page
│   │   │   └── InterviewSetup.jsx      # Interview configuration
│   │   ├── App.jsx                     # Main application component
│   │   ├── config.js                   # Frontend configuration
│   │   └── main.jsx                    # Application entry point
│   ├── package.json                    # Frontend dependencies
│   ├── vite.config.js                  # Vite configuration
│   ├── tailwind.config.js              # TailwindCSS configuration
│   └── index.html                      # HTML template
└── README.md                           # Project documentation
```
---

**Built with ❤️ by [Muhammad Navas](https://github.com/muhammadnavas) and the amazing contributors above**

> Transform your technical hiring process with AI-powered interviews that provide comprehensive, unbiased, and detailed candidate assessments.
