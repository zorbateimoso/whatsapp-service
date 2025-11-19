# Dockerfile para WhatsApp Service
# Este container roda APENAS o serviço de WhatsApp separado do backend

FROM node:20-bookworm-slim

# Instalar dependências do sistema necessárias para Chromium e Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Criar diretório de trabalho
WORKDIR /app

# Copiar package.json e yarn.lock
COPY package.json yarn.lock ./

# Instalar dependências
RUN yarn install --production --frozen-lockfile

# Copiar código do serviço
COPY . .

# Criar diretórios para sessões e cache
RUN mkdir -p .wwebjs_auth session/chromium_profile \
    && chmod -R 755 .wwebjs_auth session

# Expor porta do serviço
EXPOSE 8002

# Variáveis de ambiente
ENV NODE_ENV=production \
    PORT=8002 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8002/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Comando de inicialização
CMD ["node", "server.js"]