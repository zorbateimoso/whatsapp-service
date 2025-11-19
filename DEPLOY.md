# 🚀 Deploy do WhatsApp Service (Docker)

## 📋 Visão Geral

Este documento explica como fazer o deploy do **whatsapp-service** em um servidor separado usando Docker, permitindo que o backend na Emergent se comunique com ele via HTTP.

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────┐
│  EMERGENT (Produção)                │
│  ├─ Backend (FastAPI) :8001         │
│  ├─ Frontend (React) :3000          │
│  └─ MongoDB :27017                  │
└──────────────┬──────────────────────┘
               │ HTTP
               │ (WHATSAPP_SERVICE_URL)
               ↓
┌─────────────────────────────────────┐
│  SERVIDOR EXTERNO (VPS/Cloud)       │
│  └─ WhatsApp Service (Docker) :8002 │
│     ├─ Node.js + Express            │
│     ├─ whatsapp-web.js              │
│     └─ Chromium Browser             │
└─────────────────────────────────────┘
```

---

## 🛠️ Pré-requisitos

### No Servidor de Destino:

1. **Docker & Docker Compose instalados**
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh
   sudo apt-get install docker-compose-plugin
   ```

2. **Portas necessárias:**
   - Porta `8002` aberta no firewall
   - Se usar HTTPS, também porta `443`

3. **Recursos mínimos recomendados:**
   - CPU: 1 core
   - RAM: 1GB (2GB recomendado)
   - Disco: 2GB livres

---

## 📦 Passos para Deploy

### 1️⃣ Copiar Arquivos para o Servidor

```bash
# No seu computador local, comprima a pasta whatsapp-service
cd /caminho/para/projeto
tar -czf whatsapp-service.tar.gz whatsapp-service/

# Envie para o servidor via SCP
scp whatsapp-service.tar.gz usuario@seu-servidor.com:/home/usuario/

# No servidor, descomprima
ssh usuario@seu-servidor.com
cd /home/usuario
tar -xzf whatsapp-service.tar.gz
cd whatsapp-service
```

### 2️⃣ Configurar Variáveis de Ambiente

Crie um arquivo `.env` no servidor:

```bash
cat > .env << 'EOF'
# URL do backend FastAPI na Emergent
FAST API_URL=https://obramanager-6.preview.emergentagent.com

# Porta do serviço (padrão: 8002)
PORT=8002

# Ambiente
NODE_ENV=production
EOF
```

**⚠️ IMPORTANTE:** Substitua `https://obramanager-6.preview.emergentagent.com` pela URL real do seu backend em produção.

### 3️⃣ Build e Iniciar o Container

```bash
# Build da imagem Docker
docker compose build

# Iniciar o serviço em background
docker compose up -d

# Verificar logs
docker compose logs -f whatsapp-service
```

### 4️⃣ Verificar se Está Funcionando

```bash
# Health check
curl http://localhost:8002/health

# Deve retornar: {"status":"ok","service":"whatsapp-service"}
```

---

## 🔗 Configurar Backend na Emergent

### No arquivo `/app/backend/.env` da sua aplicação Emergent:

```env
# Adicione esta variável com a URL do servidor onde rodará o Docker
WHATSAPP_SERVICE_URL=http://IP_DO_SEU_SERVIDOR:8002

# Exemplo:
# WHATSAPP_SERVICE_URL=http://45.123.45.67:8002
# ou com domínio:
# WHATSAPP_SERVICE_URL=https://whatsapp.seudominio.com
```

### Atualizar código do backend para usar a variável:

O código do backend já deve estar preparado para usar `WHATSAPP_SERVICE_URL` ao invés de `http://localhost:8002`.

---

## 🔒 Segurança (RECOMENDAÇÕES)

### 1. Usar HTTPS com Nginx Reverse Proxy

```bash
# Instalar Nginx e Certbot
sudo apt-get install nginx certbot python3-certbot-nginx

# Configurar Nginx
sudo nano /etc/nginx/sites-available/whatsapp-service
```

```nginx
server {
    listen 80;
    server_name whatsapp.seudominio.com;

    location / {
        proxy_pass http://localhost:8002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
# Ativar site
sudo ln -s /etc/nginx/sites-available/whatsapp-service /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Obter certificado SSL
sudo certbot --nginx -d whatsapp.seudominio.com
```

### 2. Firewall

```bash
# UFW (Ubuntu)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# Bloquear acesso direto à porta 8002 (só via Nginx)
sudo ufw deny 8002/tcp
```

### 3. Autenticação (Opcional)

Adicione um token de autenticação para proteger os endpoints:

```bash
# No .env do servidor
AUTH_TOKEN=seu-token-secreto-aqui-12345
```

---

## 📊 Monitoramento e Manutenção

### Ver Logs em Tempo Real
```bash
docker compose logs -f whatsapp-service
```

### Verificar Status
```bash
docker compose ps
```

### Reiniciar Serviço
```bash
docker compose restart whatsapp-service
```

### Atualizar Código
```bash
# Parar container
docker compose down

# Fazer pull/upload do código novo
git pull  # ou scp novo arquivo

# Rebuild e restart
docker compose build
docker compose up -d
```

### Backup das Sessões
```bash
# As sessões ficam em volumes Docker
docker volume ls

# Backup
docker run --rm -v whatsapp-service_whatsapp-sessions:/data -v $(pwd):/backup \
  alpine tar czf /backup/whatsapp-sessions-backup.tar.gz -C /data .
```

### Restaurar Backup
```bash
docker run --rm -v whatsapp-service_whatsapp-sessions:/data -v $(pwd):/backup \
  alpine sh -c "cd /data && tar xzf /backup/whatsapp-sessions-backup.tar.gz"
```

---

## 🐛 Troubleshooting

### Container não inicia
```bash
# Ver logs detalhados
docker compose logs whatsapp-service

# Entrar no container
docker compose exec whatsapp-service bash

# Verificar Chromium
chromium --version
```

### QR Code não aparece
```bash
# Testar endpoint
curl -X POST http://localhost:8002/initialize \
  -H "Content-Type: application/json" \
  -d '{"userId":"test-123"}'

# Aguardar alguns segundos e pegar QR
curl http://localhost:8002/qr/test-123
```

### Backend não consegue conectar
```bash
# No servidor do WhatsApp, verificar se porta está aberta
sudo netstat -tulpn | grep 8002

# Testar do backend
curl http://IP_DO_SERVIDOR:8002/health
```

---
## 💰 Estimativa de Custos

### Opções de VPS:

| Provedor | Plano | Custo/mês | Specs |
|----------|-------|-----------|-------|
| DigitalOcean | Basic Droplet | $6 USD | 1 CPU, 1GB RAM |
| Contabo | VPS S | €5 EUR | 2 CPU, 4GB RAM |
| Vultr | Regular Performance | $6 USD | 1 CPU, 1GB RAM |
| Hetzner | CX11 | €4.5 EUR | 1 CPU, 2GB RAM |

---

## 📞 Suporte

Se tiver problemas:
1. Verifique os logs: `docker compose logs -f`
2. Teste conectividade: `curl http://localhost:8002/health`
3. Revise as variáveis de ambiente no `.env`

---

## ✅ Checklist Final

- [ ] Docker e Docker Compose instalados no servidor
- [ ] Arquivos copiados para o servidor
- [ ] Arquivo `.env` configurado com URL correta do backend
- [ ] Container rodando: `docker compose ps`
- [ ] Health check OK: `curl http://localhost:8002/health`
- [ ] Firewall configurado (porta 8002 ou 443)
- [ ] Backend configurado com `WHATSAPP_SERVICE_URL`
- [ ] (Opcional) HTTPS configurado com Nginx + Certbot
- [ ] Backup das sessões configurado

---

🎉 **Pronto! Seu WhatsApp Service está rodando em produção!**