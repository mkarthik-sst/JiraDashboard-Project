/** Realistic SAP Clean Core demo data so the dashboard is populated on first run (`npm run dev`). */
import { randomUUID } from "node:crypto";
import { fingerprint } from "./dedup";
import type { DefectRecord } from "./schema";
import type { DuplicateEvent, UploadSummary } from "./types";

type Seed = Partial<DefectRecord> & Pick<DefectRecord, "Summary" | "Description" | "ProjectKey" | "IssueType" | "Priority" | "AssigneeEmail" | "ReporterEmail">;

export const SEED_SET = "00000000-0000-4000-8000-000000000001";
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

function mk(s: Seed, i: number): DefectRecord {
  return {
    Customer: "Demo Customer", ProjectName: "Jira Automate Ignite Testing", ProjectType: "software", Lead: "Anita Rao",
    AssignApprovalStatus: "In Progress", AttachmentPaths: "", uploadId: SEED_SET, lastWarning: "", attachments: [],
    JiraTicketID: "", ExecutionStatus: "PENDING", ProcessedAt: "", DuplicateOccurrenceCount: 0,
    ReassignedToEmail: "", ReassignStatus: "None",
    AutomatedFix: "No", FixRuleId: "", RootCause: "", Impact: "", Prerequisites: "", DependentSources: "", CancelReason: "",
    id: randomUUID(), fingerprint: fingerprint(s.Summary, s.Description), sourceFile: "seed_cleancore_q4.xlsx", sourceRow: i + 2,
    createdAt: ago(600 - i * 20), lastError: "", lastErrorStack: "", jiraUrl: "", processingMs: 0,
    ...s,
  };
}

const R = { dev: "dev.lead@smartshift.com", cds: "cds.expert@smartshift.com", cfl: "cfl.owner@smartshift.com", amf: "amf.engineer@smartshift.com", qa: "qa.analyst@smartshift.com", arch: "clean.core.architect@smartshift.com" };

export function buildSeed() {
  const approved = (key: string, mins: number, ms: number): Partial<DefectRecord> => ({
    AssignApprovalStatus: "Approved", ExecutionStatus: "PROCESSED", JiraTicketID: key, ProcessedAt: ago(mins),
    jiraUrl: `https://mock.atlassian.net/browse/${key}`, processingMs: ms,
  });
  const seeds: Seed[] = [
    { ProjectKey: "JAIT", IssueType: "Bug", Priority: "High", AssigneeEmail: R.cds, ReporterEmail: R.qa,
      Summary: "CDS view ZI_SalesDocItem returns duplicate rows after VBAP replacement",
      Description: "After replacing direct SELECT on VBAP with CDS view ZI_SalesDocItem, item count doubles for orders with multiple schedule lines (VBEP). Join cardinality on _ScheduleLine association is MANY instead of ONE. Expected one row per item.",
      DuplicateOccurrenceCount: 2, ...approved("JAIT-1001", 300, 1180) },
    { ProjectKey: "JAIT", IssueType: "Bug", Priority: "High", AssigneeEmail: R.dev, ReporterEmail: R.qa,
      Summary: "ABAP dump TIME_OUT in ZCL_MIG_MATDOC_READER=>READ_MKPF after MATDOC CDS switch",
      Description: "Runtime error TIME_OUT in method READ_MKPF of class ZCL_MIG_MATDOC_READER. SELECT FROM I_MaterialDocumentItem without material filter on 40M rows. Occurs in batch job ZMIG_STOCK_RECON. Short dump ST22 attached.", ...approved("JAIT-1002", 240, 940) },
    { ProjectKey: "JAIT", IssueType: "Task", Priority: "Medium", AssigneeEmail: R.cfl, ReporterEmail: R.arch,
      Summary: "CFL: custom field ZZ_REGION missing on VBAK extension after S/4HANA conversion",
      Description: "Custom Fields and Logic app does not expose ZZ_REGION for sales order header after conversion from ECC. Append structure CI_VBAK was not migrated to the extension include. Need field re-creation with usage in CDS extension view.",
      ...approved("JAIT-1003", 180, 870) },
    { ProjectKey: "JAIT", IssueType: "Bug", Priority: "Low", AssigneeEmail: R.amf, ReporterEmail: R.qa,
      Summary: "AMF syntax failure: unexpected token 'ENDMETHOD' in ZAMF_PRICING_RULE definition",
      Description: "Activation of AMF artifact ZAMF_PRICING_RULE fails with syntax error 'Unexpected token ENDMETHOD' at line 42. Occurs after upgrade of ADT to 3.44. Reproducible in dev system D01.",
      ...approved("JAIT-1004", 120, 1010) },

    { ProjectKey: "JAIT", IssueType: "Bug", Priority: "High", AssigneeEmail: R.cds, ReporterEmail: R.qa,
      Summary: "Table-to-CDS: BSEG replacement via I_JournalEntryItem loses currency amounts in KPI report",
      Description: "Report ZFI_OPEN_ITEMS reads BSEG directly. After switching to CDS I_JournalEntryItem the AmountInCompanyCodeCurrency is zero for foreign currency postings. Currency conversion annotation @Semantics.amount.currencyCode appears missing in custom projection view ZC_OpenItems." },
    { ProjectKey: "JAIT", IssueType: "Bug", Priority: "High", AssigneeEmail: R.dev, ReporterEmail: R.qa,
      Summary: "ABAP dump ITAB_DUPLICATE_KEY in ZCL_CC_PRICE_LOADER=>BUILD_BUFFER",
      Description: "Runtime error ITAB_DUPLICATE_KEY raised while inserting into sorted table lt_price_buffer with unique key (kschl, matnr). Duplicate condition records exist after Table-to-CDS migration of A004. Program ZSD_PRICE_REFRESH terminates." },
    { ProjectKey: "JAIT", IssueType: "Task", Priority: "Medium", AssigneeEmail: R.cfl, ReporterEmail: R.arch,
      Summary: "CFL: custom business logic BAdI for pricing not triggered in Fiori app Manage Sales Orders",
      Description: "Implementation of BAdI SD_PRICING_CUSTOM created via Custom Logic app is active but not triggered when saving from the Manage Sales Orders Fiori app. Works in GUI VA02. Need to check extension point release state." },
    { ProjectKey: "JAIT", IssueType: "Bug", Priority: "Medium", AssigneeEmail: R.amf, ReporterEmail: R.qa,
      Summary: "AMF method ZAMF_CALC_TAX raises CX_SY_CONVERSION_NO_NUMBER on empty tax code",
      Description: "CONVT_NO_NUMBER dump when tax code field is blank in the AMF method ZAMF_CALC_TAX. Input comes from the migrated CDS view ZI_TaxCode which returns an empty string instead of initial value." },
    { ProjectKey: "JAIT", IssueType: "Bug", Priority: "Low", AssigneeEmail: R.arch, ReporterEmail: R.dev,
      Summary: "Clean Core ATC check flags 14 classic API usages in ZCL_BILLING_UTIL (non-released CL_GUI_ALV_GRID)",
      Description: "ATC variant ABAP_CLOUD_READINESS reports usage of non-released API CL_GUI_ALV_GRID and function module POPUP_TO_CONFIRM in ZCL_BILLING_UTIL. Need released successor or wrapper per Clean Core level A/B." },

    { ProjectKey: "JAIT", IssueType: "Bug", Priority: "Medium", AssigneeEmail: R.cfl, ReporterEmail: R.qa,
      Summary: "CFL: custom field ZZ_PLANT_GRP not visible in Manage Purchase Orders UI",
      Description: "Field ZZ_PLANT_GRP created through Custom Fields app is published but not rendered on the PO item screen. UI adaption mode shows the field as unavailable.",
      AssignApprovalStatus: "Changed Assignee", ReassignedToEmail: "senior.cfl@smartshift.com", ReassignStatus: "In Progress" },
    { ProjectKey: "JAIT", IssueType: "Bug", Priority: "High", AssigneeEmail: R.dev, ReporterEmail: R.qa,
      Summary: "ABAP dump DBIF_RSQL_INVALID_RSQL in ZMM_STOCK_REPORT after HANA pushdown rewrite",
      Description: "Open SQL statement with JOIN on CDS entity I_ProductPlantBasic and aggregate COUNT( DISTINCT ) raises DBIF_RSQL_INVALID_RSQL. Statement is valid in SQL console. Occurs with ABAP release 7.58.",
      ExecutionStatus: "FAILED", lastError: "Jira rate limit hit - HTTP 429 after 3 attempts", lastErrorStack: "JiraError: Jira rate limit hit\n    at toJiraError (src/lib/jira.ts:61)\n    at createOnce (src/lib/jira.ts:128)" },
  ];
  const records = seeds.map(mk);
  const dupTarget = records[0];
  const duplicates: DuplicateEvent[] = [
    { id: randomUUID(), at: ago(95), summary: dupTarget.Summary, score: 1, kind: "exact", matchedRecordId: dupTarget.id,
      matchedJiraId: dupTarget.JiraTicketID, newCount: 2, sourceFile: "seed_cleancore_q4.xlsx", sourceRow: 14 },
  ];
  const uploads: UploadSummary[] = [
    { id: SEED_SET, at: ago(600), fileName: "seed_cleancore_q4.xlsx", mode: "immediate", totalRows: 13, staged: 11, duplicates: 2, invalid: 0, issues: [], warnings: [] },
  ];
  return { records, duplicates, uploads };
}
