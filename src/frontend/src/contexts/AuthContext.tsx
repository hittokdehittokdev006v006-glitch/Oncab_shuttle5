import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { hasRole } from '../utils/roles';

interface User {
  id: number;
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  is_active: boolean;
  role?: { id: number; name: string; display_name: string };
}

interface AuthContextType {
  user: User | null;
  permissions: string[];
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasRole: (roleOrUser: any, maybeRole?: string) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) { setIsLoading(false); return; }
      const resp = await api.get('/auth/me');
      if (resp.data.success) {
        setUser(resp.data.data.user);
        setPermissions(resp.data.data.permissions || []);
      }
    } catch {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      setUser(null);
      setPermissions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refreshUser(); }, [refreshUser]);

  const login = async (email: string, password: string) => {
    const deviceInfo = {
      screen_width: window.screen?.width || window.innerWidth,
      screen_height: window.screen?.height || window.innerHeight,
      color_depth: window.screen?.colorDepth || 24,
      pixel_ratio: window.devicePixelRatio || 1,
      device_type: window.innerWidth <= 768 ? 'mobile' : window.innerWidth <= 1024 ? 'tablet' : 'desktop',
    };
    const resp = await api.post('/auth/login', { email, password, device_info: deviceInfo });
    const { user, permissions, accessToken, refreshToken } = resp.data.data;
    localStorage.setItem('access_token', accessToken);
    localStorage.setItem('refresh_token', refreshToken);
    setUser(user);
    setPermissions(permissions);
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
    setPermissions([]);
  };

  const hasPermission = useCallback((permission: string) => {
    if (hasRole(user, 'admin')) return true;
    if (permissions.includes(permission)) return true;
    return permissions.includes(`${permission.split('.')[0]}.manage`);
  }, [permissions, user]);

  const checkRole = useCallback((roleOrUser: any, maybeRole?: string) => {
    if (maybeRole !== undefined && typeof maybeRole === 'string') {
      return hasRole(roleOrUser, maybeRole);
    }
    if (typeof roleOrUser === 'string') {
      return hasRole(user, roleOrUser);
    }
    return false;
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, permissions, isLoading, isAuthenticated: !!user, login, logout, hasPermission, hasRole: checkRole, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
