"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PermissionCode, RoleCode } from "@/lib/permissions";

export interface SessionData {
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
  };
  isPlatformAdmin?: boolean;
  company: {
    id: string;
    legalName: string;
    tradeName: string;
    cnpj: string;
    logoUrl: string | null;
    licenseStatus?: string;
    licensePlan?: string | null;
    licenseExpiresAt?: string | null;
    licenseState?: "ok" | "expiring" | "expired" | "pending" | "suspended";
    licenseDaysLeft?: number | null;
  };
  establishment: {
    id: string;
    name: string;
    code: string;
    cnpj: string | null;
    address: string | null;
    phone: string | null;
  };
  membership: {
    id: string;
    roleCode: RoleCode;
    maxDiscountPercent: number;
  };
  settings: {
    allowNegativeStock: boolean;
    allowDuplicateBarcode: boolean;
    maxDiscountPercent: number;
    managerMaxDiscountPercent: number;
    decimalPlaces: number;
    currency: string;
    requireOpenCashRegister: boolean;
    singleOpenCashPerOperator: boolean;
    receiptFooter: string;
    thermalPrintEnabled: boolean;
  };
  permissions: PermissionCode[];
  availableCompanies: Array<{
    companyId: string;
    tradeName: string;
    cnpj: string;
    roleCode: string;
    establishments: Array<{ id: string; name: string; code: string }>;
  }>;
}

interface SessionContextValue {
  session: SessionData | null;
  loading: boolean;
  hasPermission: (code: PermissionCode) => boolean;
  refreshSession: () => Promise<void>;
  switchContext: (companyId: string, establishmentId?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({
  session: null,
  loading: true,
  hasPermission: () => false,
  refreshSession: async () => {},
  switchContext: async () => {},
  logout: async () => {},
});

export function SessionProvider({
  initialSession,
  children,
}: {
  initialSession: SessionData | null;
  children: React.ReactNode;
}) {
  const [session, setSession] = useState<SessionData | null>(initialSession);
  const [loading, setLoading] = useState(!initialSession);
  const router = useRouter();

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) {
        setSession(null);
        return;
      }
      const data = await res.json();
      setSession(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialSession) {
      refreshSession();
    }
  }, [initialSession, refreshSession]);

  const hasPermission = useCallback(
    (code: PermissionCode) => {
      if (!session) return false;
      return session.permissions.includes(code);
    },
    [session]
  );

  const switchContext = useCallback(
    async (companyId: string, establishmentId?: string) => {
      const res = await fetch("/api/auth/switch-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, establishmentId }),
      });
      if (!res.ok) {
        throw new Error("Não foi possível trocar o contexto da empresa.");
      }
      await refreshSession();
      router.refresh();
    },
    [refreshSession, router]
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession(null);
    router.push("/login");
    router.refresh();
  }, [router]);

  return (
    <SessionContext.Provider
      value={{
        session,
        loading,
        hasPermission,
        refreshSession,
        switchContext,
        logout,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
