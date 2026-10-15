import { randomBytes } from 'node:crypto';
export const newTicketCode = () => randomBytes(16).toString('base64url'); // 128 bits
export const newReference = () => 'WN-' + randomBytes(9).toString('base64url');
