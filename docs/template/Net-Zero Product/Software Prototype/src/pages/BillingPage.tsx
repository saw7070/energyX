import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, Filter, Send, Wallet } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { DataTable, DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAppContext } from "@/context/AppContext";
import { bills, tenants } from "@/mock/mockData";
import { Bill, Tenant } from "@/mock/types";

type BillingSection = "tenants" | "contracts" | "bills";

interface BillingPageProps {
  section?: BillingSection;
}

const sectionMeta: Record<BillingSection, { title: string; subtitle: string; breadcrumbs: string[] }> = {
  tenants: {
    title: "Billing / Tenants",
    subtitle: "Tenant registry, occupancy mapping, and account setup workflow.",
    breadcrumbs: ["Dashboard", "Billing", "Tenants"]
  },
  contracts: {
    title: "Billing / Contracts",
    subtitle: "Contract templates, tariff policies, and cycle assignment workflows.",
    breadcrumbs: ["Dashboard", "Billing", "Contracts"]
  },
  bills: {
    title: "Billing / Bills",
    subtitle: "Bill generation, review, delivery, and payment status tracking.",
    breadcrumbs: ["Dashboard", "Billing", "Bills"]
  }
};

interface BillingTableRow extends Record<string, unknown> {
  id: string;
  tenant: string;
  period: string;
  amount: number;
  status: Bill["status"];
  dueDate: string;
}

const billStatusStyle: Record<Bill["status"], string> = {
  draft: "bg-slate-500/20 text-slate-300 border-slate-500/40",
  generated: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  sent: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  paid: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
};

function hashCode(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function seeded(seed: number, offset = 0) {
  const value = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function buildProjectTenants(projectId: string, projectName: string): Tenant[] {
  const seed = hashCode(projectId);
  const count = 2 + Math.floor(seeded(seed, 1) * 2);
  const cycles = ["Monthly", "Bi-monthly", "Quarterly"];
  const contractTypes = ["Sub-metered", "Fixed + Variable", "Bulk Utility"];
  return Array.from({ length: count }, (_, index) => ({
    id: `tenant-${projectId}-${index + 1}`,
    projectId,
    name: `${projectName} Tenant ${String(index + 1).padStart(2, "0")}`,
    unit: `Unit ${String(100 + index * 3).padStart(3, "0")} - ${String(102 + index * 3).padStart(3, "0")}`,
    contractType: contractTypes[index % contractTypes.length],
    billingCycle: cycles[index % cycles.length]
  }));
}

function buildProjectBills(projectId: string, tenantList: Tenant[]): Bill[] {
  const statuses: Bill["status"][] = ["draft", "generated", "sent", "paid"];
  const seed = hashCode(projectId);
  return tenantList.map((tenant, index) => ({
    id: `bill-${projectId}-${index + 1}`,
    tenantId: tenant.id,
    period: "2026-04",
    amount: 7600 + Math.round(seeded(seed, index + 10) * 9200),
    status: statuses[index % statuses.length]
  }));
}

export function BillingPage({ section = "bills" }: BillingPageProps) {
  const { selectedProjectId, availableProjects } = useAppContext();
  const currentMeta = sectionMeta[section];
  const [cycleFilter, setCycleFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<"all" | Bill["status"]>("all");
  const [tenantFilter, setTenantFilter] = useState("all");
  const selectedProject = useMemo(() => availableProjects.find((project) => project.id === selectedProjectId), [availableProjects, selectedProjectId]);
  const projectName = selectedProject?.name ?? "Selected Project";

  const scopedTenants = useMemo(() => {
    const matched = tenants.filter((tenant) => tenant.projectId === selectedProjectId);
    if (matched.length > 0) {
      return matched;
    }
    return buildProjectTenants(selectedProjectId, projectName);
  }, [projectName, selectedProjectId]);

  const scopedBills = useMemo(() => {
    const tenantIds = new Set(scopedTenants.map((tenant) => tenant.id));
    const matched = bills.filter((bill) => tenantIds.has(bill.tenantId));
    if (matched.length > 0) {
      return matched;
    }
    return buildProjectBills(selectedProjectId, scopedTenants);
  }, [scopedTenants, selectedProjectId]);

  useEffect(() => {
    setCycleFilter("All");
    setStatusFilter("all");
    setTenantFilter("all");
  }, [selectedProjectId]);

  const tableRows = useMemo<BillingTableRow[]>(() => {
    const periodDueDateMap: Record<string, string> = {
      "2026-04": "2026-05-10",
      "2026-03": "2026-04-10",
      "2026-02": "2026-03-10"
    };
    return scopedBills.map((bill) => {
      const tenant = scopedTenants.find((item) => item.id === bill.tenantId);
      return {
        id: bill.id,
        tenant: tenant?.name ?? "Unknown Tenant",
        period: bill.period,
        amount: bill.amount,
        status: bill.status,
        dueDate: periodDueDateMap[bill.period] ?? "2026-05-20"
      };
    });
  }, [scopedBills, scopedTenants]);

  const filteredRows = useMemo(() => {
    return tableRows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) {
        return false;
      }
      if (tenantFilter !== "all" && row.tenant !== tenantFilter) {
        return false;
      }
      if (cycleFilter !== "All") {
        const tenant = scopedTenants.find((item) => item.name === row.tenant);
        if (!tenant || tenant.billingCycle !== cycleFilter) {
          return false;
        }
      }
      return true;
    });
  }, [cycleFilter, scopedTenants, statusFilter, tableRows, tenantFilter]);

  const metrics = useMemo(() => {
    const totalAmount = filteredRows.reduce((sum, row) => sum + row.amount, 0);
    const paidAmount = filteredRows.filter((row) => row.status === "paid").reduce((sum, row) => sum + row.amount, 0);
    const generatedAmount = filteredRows.filter((row) => row.status === "generated").reduce((sum, row) => sum + row.amount, 0);
    return {
      totalAmount,
      paidAmount,
      generatedAmount,
      outstandingAmount: Math.max(totalAmount - paidAmount, 0)
    };
  }, [filteredRows]);

  const billingColumns: DataTableColumn<BillingTableRow>[] = [
    { key: "tenant", header: "Tenant" },
    { key: "period", header: "Billing Period" },
    {
      key: "amount",
      header: "Amount (SGD)",
      render: (row) => <span className="font-semibold text-white">{row.amount.toLocaleString()}</span>
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium capitalize ${billStatusStyle[row.status]}`}>{row.status}</span>
      )
    },
    { key: "dueDate", header: "Due Date" },
    {
      key: "actions",
      header: "Actions",
      render: () => (
        <button className="rounded-md border border-shell-600 bg-shell-900 px-2 py-1 text-xs text-slate-300 hover:bg-shell-700 hover:text-white">View</button>
      )
    }
  ];

  const selectedTenantOptions = Array.from(new Set(tableRows.map((row) => row.tenant)));
  const cycleOptions = ["All", ...Array.from(new Set(scopedTenants.map((tenant) => tenant.billingCycle)))];

  return (
    <PageContainer
      title={currentMeta.title}
      subtitle={currentMeta.subtitle}
      breadcrumbs={currentMeta.breadcrumbs}
    >
      <section className="panel p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="space-y-1">
            <span className="text-xs text-slate-400">Tenant</span>
            <select className="w-full rounded-md border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-200" value={tenantFilter} onChange={(event) => setTenantFilter(event.target.value)}>
              <option value="all">All Tenants</option>
              {selectedTenantOptions.map((tenant) => (
                <option key={tenant} value={tenant}>
                  {tenant}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-400">Billing Cycle</span>
            <select className="w-full rounded-md border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-200" value={cycleFilter} onChange={(event) => setCycleFilter(event.target.value)}>
              {cycleOptions.map((cycle) => (
                <option key={cycle} value={cycle}>
                  {cycle}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-400">Bill Status</span>
            <select
              className="w-full rounded-md border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-200"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | Bill["status"])}
            >
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="generated">Generated</option>
              <option value="sent">Sent</option>
              <option value="paid">Paid</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-400">Period</span>
            <input type="month" className="w-full rounded-md border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-200" defaultValue="2026-04" />
          </label>
          <div className="flex items-end gap-2">
            <button className="inline-flex items-center gap-2 rounded-md border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-200 hover:bg-shell-700">
              <Filter className="h-4 w-4" />
              Apply
            </button>
            <button className="inline-flex items-center gap-2 rounded-md border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-200 hover:bg-shell-700">
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="panel p-4">
          <p className="text-xs text-slate-400">Monthly Charges</p>
          <p className="mt-2 text-2xl font-semibold text-white">SGD {metrics.totalAmount.toLocaleString()}</p>
        </article>
        <article className="panel p-4">
          <p className="text-xs text-slate-400">Outstanding</p>
          <p className="mt-2 text-2xl font-semibold text-rose-300">SGD {metrics.outstandingAmount.toLocaleString()}</p>
        </article>
        <article className="panel p-4">
          <p className="text-xs text-slate-400">Paid Bills</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-300">SGD {metrics.paidAmount.toLocaleString()}</p>
        </article>
        <article className="panel p-4">
          <p className="text-xs text-slate-400">Generated</p>
          <p className="mt-2 text-2xl font-semibold text-blue-300">SGD {metrics.generatedAmount.toLocaleString()}</p>
        </article>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="space-y-4">
          <h2 className="section-title">{section === "tenants" ? "Tenant List" : "Tenant Registry"}</h2>
          <DataTable
            columns={[
              { key: "name", header: "Tenant" },
              { key: "unit", header: "Unit" },
              { key: "contractType", header: "Contract" },
              { key: "billingCycle", header: "Cycle" }
            ]}
            rows={scopedTenants}
          />
        </section>

        <section className="space-y-4">
          <h2 className="section-title">
            {section === "contracts" ? "Contract Register" : section === "bills" ? "Bill Register" : "Contract / Bill Center"}
          </h2>
          <DataTable columns={billingColumns} rows={filteredRows} />
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <EmptyState
          title="Bill Generation"
          description="Batch generate tenant bills, rerun exceptions, and approval queue placeholder."
          icon={<FileSpreadsheet className="h-5 w-5" />}
        />
        <EmptyState
          title="Billing Rules"
          description="Tariff matrix, surcharge logic, and contract policy designer placeholder."
          icon={<Wallet className="h-5 w-5" />}
        />
        <EmptyState
          title="Invoice Dispatch"
          description="Email/sync delivery pipeline with send status and retry queue placeholder."
          icon={<Send className="h-5 w-5" />}
        />
      </div>
    </PageContainer>
  );
}
