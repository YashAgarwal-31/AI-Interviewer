import { Schema, model } from 'mongoose';

const authSessionSchema = new Schema({
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    index: true,
    select: false
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  lastSeenAt: {
    type: Date,
    default: Date.now
  },
  ip: String,
  userAgent: String
}, {
  timestamps: true
});

authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
authSessionSchema.index({ userId: 1, expiresAt: 1 });

export default model('AuthSession', authSessionSchema);
