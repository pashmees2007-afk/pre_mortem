# Tier-1 Evidence Source Research

## Verified trusted domains and relevant material

| Domain | Evidence focus | Source |
|---|---|---|
| `kubernetes.io` | Deployments support controlled rollouts, rollout status checks, and rollback to an earlier revision when a deployment is unstable. [1] | Kubernetes documentation |
| `sre.google` | Production changes should use staged rollouts, monitored progress, and rollback first when unexpected behavior appears. [2] | Google SRE guidance |
| `docs.stripe.com` | Webhook endpoints receive asynchronous payment events; handlers must verify signed payloads and respond quickly before complex work. [3] | Stripe documentation |
| `docs.aws.amazon.com` | Reliability guidance covers resilient architecture, consistent change management, and proven failure recovery. [4] | AWS documentation |

## Implementation decision

Evidence retrieval should first query a bounded set of Tier-1 domains tailored to the research question, then query the open web only if fewer than two usable Tier-1 sources are retained. Tier-1 sources remain subject to the same HTTPS, title, and snippet checks as every other source. The critic should check Tier-1 coverage by branch, not just across the combined source set.

## References

[1]: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ "Kubernetes — Deployments"
[2]: https://sre.google/sre-book/service-best-practices/ "Google SRE — Production Services Best Practices"
[3]: https://docs.stripe.com/webhooks "Stripe — Receive Stripe events in your webhook endpoint"
[4]: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html "AWS Well-Architected Framework — Reliability Pillar"
