import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { base44, SESSION_ENDED_EVENT } from '@/api/base44Client';
import { canUpdateTransaction, hasPermission } from '@/lib/permissions';

const AuthContext = createContext();

// Session state for the app. The session itself is an HTTP-only cookie managed by the server;
// on load we ask the server who is signed in (/auth/me). The session lasts until logout.
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const signedOut = useCallback(() => {
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      setAuthError(null);
    } catch (error) {
      if (error?.status !== 401) {
        console.error('User auth check failed:', error);
      }
      signedOut();
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  }, [signedOut]);

  useEffect(() => {
    checkUserAuth();
  }, [checkUserAuth]);

  // Any API call answered with 401 (session deleted by logout elsewhere, deactivation or a
  // password reset) returns the app to the login screen.
  useEffect(() => {
    window.addEventListener(SESSION_ENDED_EVENT, signedOut);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, signedOut);
  }, [signedOut]);

  const login = async (email, password) => {
    try {
      const currentUser = await base44.auth.login(email, password);
      setUser(currentUser);
      setIsAuthenticated(true);
      setAuthError(null);
      setAuthChecked(true);
      return currentUser;
    } catch (error) {
      setAuthError({ type: 'auth_required', message: error?.message || 'Authentication required' });
      throw error;
    }
  };

  const logout = async () => {
    await base44.auth.logout();
    signedOut();
  };

  const can = useCallback((permission) => hasPermission(user, permission), [user]);
  const canEditTransaction = useCallback((transaction) => canUpdateTransaction(user, transaction), [user]);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError,
      authChecked,
      login,
      logout,
      checkUserAuth,
      can,
      canEditTransaction,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
