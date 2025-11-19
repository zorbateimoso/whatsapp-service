# 📱 WhatsApp Service - Obra Manager

## Visão Geral

Serviço independente para gerenciar conexões WhatsApp usando `whatsapp-web.js`. Este serviço foi projetado para rodar separadamente do backend principal, permitindo escalabilidade e isolamento de recursos.

## 🚀 Quick Start

### Desenvolvimento Local

```bash
# Instalar dependências
yarn install

# Iniciar serviço
node server.js
```

### Docker (Produção)

```bash
# Build
docker compose build

# Iniciar
docker compose up -d

# Ver logs
docker compose logs -f
```

## 📚 Documentação Completa

Para instruções detalhadas de deploy, configuração e troubleshooting, consulte:

👉 **[DEPLOY.md](./DEPLOY.md)**

## 🔌 Endpoints da API

### Health Check
```bash
GET /health
```

### Inicializar WhatsApp
```bash
POST /initialize
Body: { "userId": "string" }
```

### Obter QR Code
```bash
GET /qr/:userId
```

### Status da Conexão
```bash
GET /status/:userId
```

### Listar Grupos
```bash
GET /groups/:userId
```

### Logout
```bash
POST /logout/:userId
```

## 🏗️ Estrutura do Projeto

```
whatsapp-service/
├── server.js              # Servidor Express principal
├── whatsapp-manager.js    # Gerenciador de múltiplos clientes
├── whatsapp-client.js     # Cliente WhatsApp individual
├── package.json           # Dependências Node.js
├── Dockerfile             # Configuração Docker
├── docker-compose.yml     # Orquestração Docker
├── DEPLOY.md              # Guia completo de deploy
└── README.md              # Este arquivo
```

## 🔧 Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta do serviço | `8002` |
| `FASTAPI_URL` | URL do backend | `http://localhost:8001` |
| `NODE_ENV` | Ambiente | `production` |

## 📦 Dependências Principais

- **whatsapp-web.js**: Biblioteca para integração WhatsApp
- **puppeteer**: Automação do navegador
- **express**: Framework web
- **qrcode**: Geração de QR codes

## ⚠️ Requisitos do Sistema

- Node.js 20+
- Chromium browser
- 1GB RAM mínimo (2GB recomendado)
- 2GB disco livre

## 📝 Licença

Este projeto faz parte do Obra Manager.