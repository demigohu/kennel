FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-package-lock
COPY index.mjs lib.mjs ./
ENV PORT=8787
EXPOSE 8787
CMD ["node", "index.mjs"]
