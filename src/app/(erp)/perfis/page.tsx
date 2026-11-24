"use client";

import React from "react";
import { Check, Minus } from "lucide-react";
import {
  ALL_PERMISSIONS,
  ROLE_DEFINITIONS,
  RoleCode,
} from "@/lib/permissions";
import { Badge, Panel } from "@/components/ui/primitives";

const ROLES: RoleCode[] = ["admin", "manager", "cashier", "stockist"];

export default function PerfisPage() {
  const modules = Array.from(new Set(ALL_PERMISSIONS.map((p) => p.module)));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-slate-900">
          Perfis e Permissões por Ação
        </h1>
        <p className="text-xs text-slate-500">
          Matriz de segurança aplicada simultaneamente no backend (APIs e banco) e
          na interface
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((code) => {
          const def = ROLE_DEFINITIONS[code];
          return (
            <div
              key={code}
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">{def.name}</h2>
                <Badge tone="primary">{def.permissions.length} ações</Badge>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                {def.description}
              </p>
            </div>
          );
        })}
      </div>

      <Panel
        title="Matriz de Permissões Granulares"
        subtitle="Operadores de caixa não possuem acesso a preços de custo nem dados financeiros administrativos"
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Módulo / Permissão</th>
                <th className="px-4 py-2.5">Código</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-4 py-2.5 text-center">
                    {ROLE_DEFINITIONS[r].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {modules.map((mod) => (
                <React.Fragment key={mod}>
                  <tr className="bg-slate-50/70">
                    <td
                      colSpan={2 + ROLES.length}
                      className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[#0f4c5c]"
                    >
                      {mod}
                    </td>
                  </tr>
                  {ALL_PERMISSIONS.filter((p) => p.module === mod).map((perm) => (
                    <tr key={perm.code} className="hover:bg-slate-50/80">
                      <td className="px-4 py-2 font-medium text-slate-800">
                        {perm.label}
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] text-slate-500">
                        {perm.code}
                      </td>
                      {ROLES.map((r) => {
                        const has = ROLE_DEFINITIONS[r].permissions.includes(
                          perm.code
                        );
                        return (
                          <td key={r} className="px-4 py-2 text-center">
                            {has ? (
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                                <Check className="h-3.5 w-3.5" />
                              </span>
                            ) : (
                              <span className="inline-flex h-5 w-5 items-center justify-center text-slate-300">
                                <Minus className="h-3.5 w-3.5" />
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
