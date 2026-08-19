import { Schema, model } from 'mongoose';

const auditLogSchema = new Schema({
  actorId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  actorEmail: {
    type: String,
    default: null,
    index: true
  },
  actorType: {
    type: String,
    enum: ['user', 'server-admin', 'system'],
    default: 'user'
  },
  action: {
    type: String,
    required: true,
    index: true
  },
  method: String,
  path: String,
  statusCode: Number,
  requestId: String,
  ip: String,
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)
  }
}, {
  timestamps: true
});

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default model('AuditLog', auditLogSchema);
