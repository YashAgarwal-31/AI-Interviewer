import { Schema, model } from 'mongoose';

const conversationMessageSchema = new Schema({
  role: {
    type: String,
    enum: ['system', 'assistant', 'user'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const interviewSessionSchema = new Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  candidateId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'ShortlistedCandidate'
  },
  applicationId: {
    type: Schema.Types.ObjectId,
    required: true
  },
  jobId: {
    type: Schema.Types.ObjectId,
    required: true
  },
  recruiterId: {
    type: Schema.Types.ObjectId,
    required: true
  },
  candidateDetails: {
    candidateName: {
      type: String,
      required: true,
      trim: true
    },
    candidateEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    phoneNumber: String,
    companyName: String,
    role: String,
    techStack: [String],
    experience: String
  },
  sessionConfig: {
    scheduledStartTime: {
      type: Date,
      required: true
    },
    scheduledEndTime: {
      type: Date,
      required: true
    },
    timeZone: {
      type: String,
      default: 'UTC'
    },
    duration: {
      type: Number,
      default: 60,
      min: 1
    },
    accessWindow: {
      beforeStart: { type: Number, default: 15, min: 0 },
      afterEnd: { type: Number, default: 15, min: 0 }
    }
  },
  sessionStatus: {
    type: String,
    enum: ['scheduled', 'active', 'completed', 'expired', 'cancelled'],
    default: 'scheduled',
    index: true
  },
  accessControl: {
    isActive: {
      type: Boolean,
      default: false
    },
    accessStartTime: Date,
    accessEndTime: Date,
    candidateJoinedAt: Date,
    candidateLeftAt: Date,
    totalTimeSpent: Number
  },
  interviewData: {
    candidateProfile: {
      type: Schema.Types.Mixed,
      default: null
    },
    interviewQuestions: {
      type: [String],
      default: []
    },
    codingTasks: {
      type: [Schema.Types.Mixed],
      default: []
    },
    systemPrompt: {
      type: String,
      default: ''
    },
    conversationHistory: {
      type: [conversationMessageSchema],
      default: []
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    },
    results: {
      fileName: String,
      savedAt: Date,
      resultSummary: String
    }
  },
  security: {
    accessTokenHash: {
      type: String,
      default: null,
      select: false
    },
    // Backward-compatibility only for sessions created before token hashing.
    // New sessions store only accessTokenHash.
    accessToken: {
      type: String,
      default: null,
      select: false
    },
    ipRestrictions: [String],
    maxLoginAttempts: {
      type: Number,
      default: 5,
      min: 1
    },
    loginAttempts: {
      type: Number,
      default: 0,
      min: 0
    },
    lastLoginAttempt: Date
  },
  notifications: {
    emailSent: {
      type: Boolean,
      default: false
    },
    remindersSent: [Date],
    confirmationSentAt: Date
  }
}, {
  timestamps: true
});

interviewSessionSchema.index({ candidateId: 1, 'sessionConfig.scheduledStartTime': 1 });
interviewSessionSchema.index({ 'security.accessTokenHash': 1 }, { sparse: true });
interviewSessionSchema.index({ sessionStatus: 1, 'sessionConfig.scheduledStartTime': 1 });

interviewSessionSchema.virtual('isAccessible').get(function() {
  const now = new Date();
  const startTime = new Date(this.sessionConfig.scheduledStartTime);
  const endTime = new Date(this.sessionConfig.scheduledEndTime);
  const accessStart = new Date(startTime.getTime() - (this.sessionConfig.accessWindow.beforeStart * 60000));
  const accessEnd = new Date(endTime.getTime() + (this.sessionConfig.accessWindow.afterEnd * 60000));

  return now >= accessStart && now <= accessEnd && ['scheduled', 'active'].includes(this.sessionStatus);
});

interviewSessionSchema.methods.activateSession = function() {
  const now = new Date();
  this.sessionStatus = 'active';
  this.accessControl.isActive = true;
  this.accessControl.accessStartTime = this.accessControl.accessStartTime || now;
  this.accessControl.candidateJoinedAt = this.accessControl.candidateJoinedAt || now;

  const endTime = new Date(this.sessionConfig.scheduledEndTime);
  this.accessControl.accessEndTime = new Date(
    endTime.getTime() + (this.sessionConfig.accessWindow.afterEnd * 60000)
  );

  return this.save();
};

interviewSessionSchema.methods.completeSession = function() {
  const now = new Date();
  this.sessionStatus = 'completed';
  this.accessControl.isActive = false;
  this.accessControl.candidateLeftAt = now;

  if (this.accessControl.candidateJoinedAt) {
    const timeSpent = (now - this.accessControl.candidateJoinedAt) / (1000 * 60);
    this.accessControl.totalTimeSpent = Math.max(0, Math.round(timeSpent));
  }

  this.interviewData = this.interviewData || {};
  this.interviewData.metadata = {
    ...(this.interviewData.metadata || {}),
    endTime: now
  };
  this.markModified('interviewData.metadata');

  return this.save();
};

interviewSessionSchema.methods.checkExpiry = function() {
  const now = new Date();
  const endTime = new Date(this.sessionConfig.scheduledEndTime);
  const accessEnd = new Date(endTime.getTime() + (this.sessionConfig.accessWindow.afterEnd * 60000));

  if (now > accessEnd && !['completed', 'cancelled', 'expired'].includes(this.sessionStatus)) {
    this.sessionStatus = 'expired';
    this.accessControl.isActive = false;
    return this.save();
  }

  return Promise.resolve(this);
};

export default model('InterviewSession', interviewSessionSchema);
