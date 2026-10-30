# EnergyX

EnergyX 是面向设施经理、可持续发展团队和成本负责人的能源管理平台：把电表读数变成清楚的答案——用了多少电、花了多少钱、哪里变了、该怎么做，以及改进是否见效。

完整说明见英文版 [README.md](README.md)。

- **产品与领域**：领域词汇表见 [docs/energyiq/CONTEXT.md](docs/energyiq/CONTEXT.md)；开发与协作约定见 [AGENTS.md](AGENTS.md)。
- **本地运行**：需要 Node.js 22；`npm install`，复制 `.env.example` 为 `.env`、`apps/web/.env.example` 为 `apps/web/.env.local`，然后 `npm run dev`。部署环境必须使用 `DATAFOUNDRY_AUTH_MODE=password`。
- **安全**：漏洞报告方式见 [SECURITY.md](SECURITY.md)；合规准备材料见 [docs/compliance](docs/compliance)。
- **部署**：预发布环境见 [docs/energyiq/runbooks/staging-environment.md](docs/energyiq/runbooks/staging-environment.md)。

许可证：Apache License 2.0（见 [LICENSE](LICENSE)）。EnergyX 源自 datagallery-lab 的开源项目 [DataFoundry](https://github.com/datagallery-lab/datafoundry)（Apache-2.0）。
