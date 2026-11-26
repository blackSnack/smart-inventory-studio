# Contribution workflow

1. Open an issue with a bounded goal, acceptance criteria and risks. Branch from main. Keep changes focused.
2. Submit a PR with actual build/test evidence and clear remaining gaps. CI is required; no bypass, no fake success, no blanket exception.
3. Review the exact head, check all required jobs and resolve material findings. Squash merge only when green and approved under repository policy. Do not force push main.
4. Main triggers Pages deployment of the simulated HTML only. A successful deploy is not live API or phone acceptance. Tag/release only after scope and evidence are explicit.

The initial import should be a PR, not a direct main push. Maintainer configures Pages source as GitHub Actions and main branch protection (required check `validate`); these settings are not changed by CI. Verify GitHub App permissions for Contents, Pull requests, Actions and Workflows. If workflow edits are blocked, the maintainer must authorize them or push locally.

Never commit tokens, real inventory exports, device IDs, NAS paths or private topology. Do not run CI against production services. Do not copy supplier proprietary datasets, images or manuals into the repository without authorization. Public links and normalized factual definitions must retain provenance.
