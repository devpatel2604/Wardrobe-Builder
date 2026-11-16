import type { RuleFinding } from '../domain/ruleChecks';
import { EvidenceTag } from './controls';

export function RuleFindings({ findings }: { findings: RuleFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <ul className="findings" aria-label="Rule checks">
      {findings.map((f) => (
        <li key={f.id} className={f.severity === 'breaks' ? 'finding finding-breaks' : 'finding finding-check'}>
          <p>
            <strong>{f.severity === 'breaks' ? 'Breaks your rule: ' : 'Worth a check: '}</strong>
            {f.rule}. <EvidenceTag evidence={f.evidence} />
          </p>
          <p className="finding-detail">{f.detail}</p>
        </li>
      ))}
    </ul>
  );
}
