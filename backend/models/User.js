import { Schema, model } from 'mongoose';

const userSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  email: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
    lowercase: true,
    maxlength: 254
  },
  passwordHash: {
    type: String,
    required: true,
    select: false
  },
  passwordSalt: {
    type: String,
    required: true,
    select: false
  },
  role: {
    type: String,
    enum: ['owner', 'admin', 'recruiter', 'reviewer'],
    default: 'recruiter',
    index: true
  },
  organizationName: {
    type: String,
    trim: true,
    default: 'InterviewBuddy'
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  lastLoginAt: Date,
  failedLoginAttempts: {
    type: Number,
    default: 0,
    min: 0
  },
  lockedUntil: Date,
  passwordChangedAt: Date,
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

userSchema.index({ role: 1, isActive: 1 });

export default model('User', userSchema);
