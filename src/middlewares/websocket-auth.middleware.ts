// middlewares/websocket-auth.middleware.ts
import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { keys } from '@configs/dotenv.config';
import { logger } from '@utils/logger';
import { Event } from '@models/event.model';
import { User } from '@models/user.model';
import { AuthenticatedSocket} from 'types/websocket.types';

/**
 * WebSocket authentication middleware - validates JWT or share tokens
 */
export const websocketAuthMiddleware = () => {
  return async (socket: Socket, next: (err?: Error) => void) => {
    try {
      const token = socket.handshake.auth?.token;
      const shareToken = socket.handshake.auth?.shareToken;
      const eventId = socket.handshake.auth?.eventId;

      // Skip auth for initial connection - will be handled in authenticate event
      // This allows clients to connect first, then authenticate
      console.log(`🔍 WebSocket middleware check for ${socket.id}:`, {
        hasToken: !!token,
        hasShareToken: !!shareToken,
        eventId
      });

      next(); // Allow connection, authentication happens later
      
    } catch (error: any) {
      logger.error(`❌ WebSocket auth middleware error:`, error);
      next(new Error('Authentication failed'));
    }
  };
};

/**
 * Validate JWT token and extract user info
 */
export const validateJWTToken = async (token: string): Promise<{
  userId: string;
  email: string;
  name: string;
  iat: number;
  exp: number;
}> => {
  try {
    const decoded = jwt.verify(token, keys.jwtSecret as string) as any;
    
    if (!decoded.userId) {
      throw new Error('Invalid token payload - missing userId');
    }

    // Optionally verify user exists in database
    const user = await User.findById(decoded.userId).select('name email');
    
    if (!user) {
      throw new Error('User not found');
    }

    return {
      userId: decoded.userId,
      email: decoded.email || user.email,
      name: decoded.name || user.name,
      iat: decoded.iat,
      exp: decoded.exp
    };

  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    } else {
      throw new Error(`Token validation failed: ${error.message}`);
    }
  }
};

/**
 * Check user permissions for event
 */
export const checkEventPermissions = async (
  userId: string, 
  eventId: string
): Promise<{
  userRole: 'admin' | 'co_host' | 'user';
  permissions: any;
  canManage: boolean;
}> => {
  try {
    const event = await Event.findById(eventId)
      .populate('created_by', '_id')
      .populate('co_hosts.user_id', '_id');

    if (!event) {
      throw new Error('Event not found');
    }

    // Check if user is event creator (admin)
    if (event.created_by._id.toString() === userId) {
      return {
        userRole: 'admin',
        permissions: {
          manage_content: true,
          manage_guests: true,
          manage_settings: true,
          approve_content: true,
          can_view: true,
          can_upload: true,
          can_download: true
        },
        canManage: true
      };
    }

    // Check if user is approved co-host
    const coHost = event.co_hosts.find((ch: any) => 
      ch.user_id._id.toString() === userId && ch.status === 'approved'
    );

    if (coHost) {
      return {
        userRole: 'co_host',
        permissions: {
          ...coHost.permissions,
          can_view: true,
          can_upload: true,
          can_download: true
        },
        canManage: coHost.permissions.manage_content || false
      };
    }

    // Regular user - check event visibility
    if (event.visibility === 'private') {
      throw new Error('Access denied - this is a private event');
    }

    return {
      userRole: 'user',
      permissions: event.permissions || {
        can_view: true,
        can_upload: false,
        can_download: false
      },
      canManage: false
    };

  } catch (error: any) {
    throw new Error(`Permission check failed: ${error.message}`);
  }
};

/**
 * Rate limiting for WebSocket connections
 */
export const websocketRateLimit = () => {
  const connections = new Map<string, { count: number; resetTime: number }>();
  const maxConnections = 10; // Max connections per IP per window
  const windowMs = 15 * 60 * 1000; // 15 minutes

  return (socket: Socket, next: (err?: Error) => void) => {
    const clientIp = socket.handshake.address;
    const now = Date.now();

    const clientData = connections.get(clientIp) || { count: 0, resetTime: now + windowMs };

    // Reset if window expired
    if (now > clientData.resetTime) {
      clientData.count = 0;
      clientData.resetTime = now + windowMs;
    }

    // Check rate limit
    if (clientData.count >= maxConnections) {
      logger.warn(`🚫 Rate limit exceeded for IP: ${clientIp}`);
      next(new Error('Rate limit exceeded'));
      return;
    }

    // Increment count
    clientData.count++;
    connections.set(clientIp, clientData);

    next();
  };
};

/**
 * Log WebSocket connections for monitoring
 */
export const websocketLogger = () => {
  return (socket: Socket, next: (err?: Error) => void) => {
    const clientInfo = {
      socketId: socket.id,
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      timestamp: new Date().toISOString()
    };

    logger.info('🔌 New WebSocket connection attempt:', clientInfo);
    next();
  };
};

/**
 * Utility function to extract user info from authenticated socket
 */
export const getSocketUserInfo = (socket: AuthenticatedSocket): {
  id: string;
  name: string;
  type: string;
  eventId: string;
} => {
  return {
    id: socket.user.id,
    name: socket.user.name || socket.user.guestName || 'Unknown',
    type: socket.user.type,
    eventId: socket.eventId
  };
};

/**
 * Check if socket has permission for specific action
 */
export const hasSocketPermission = (
  socket: AuthenticatedSocket,
  action: 'view' | 'upload' | 'approve' | 'manage'
): boolean => {
  const userType = socket.user.type;

  switch (action) {
    case 'view':
      return true; // All authenticated users can view

    case 'upload':
      return userType === 'admin' || userType === 'co_host' || userType === 'guest';

    case 'approve':
      return userType === 'admin' || userType === 'co_host';

    case 'manage':
      return userType === 'admin';

    default:
      return false;
  }
};

/**
 * Validate event access for socket
 */
export const validateSocketEventAccess = async (
  socket: AuthenticatedSocket,
  eventId: string
): Promise<boolean> => {
  try {
    // Check if socket is authenticated for this event
    if (!socket.authenticated || socket.eventId !== eventId) {
      return false;
    }

    // Additional validation could be added here
    // e.g., check if event is still active, not archived, etc.
    
    return true;

  } catch (error: any) {
    logger.error(`❌ Event access validation failed:`, error);
    return false;
  }
};