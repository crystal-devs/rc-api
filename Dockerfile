# Step 1: Use a slim Debian-based image for better compatibility with native modules like 'sharp'
FROM node:22-bookworm-slim

# Step 2: Set the working directory inside the container
WORKDIR /app

# Step 3: Copy package files first
# This is an "Expert" tip: By copying package.json files first, 
# Docker caches your dependencies. If you change your code but not your
# dependencies, Docker won't have to re-install them!
COPY package*.json ./
COPY yarn.lock ./

# Step 4: Install dependencies
RUN npm install
# Explicitly install the Linux version of sharp
RUN npm install --os=linux --cpu=x64 sharp

# Step 5: Copy the rest of your application code
COPY . .

# Step 6: Expose the port your app runs on (from .env PORT=3001)
EXPOSE 3001

# Step 7: The command to run your app
# We use 'npm run dev' for development mode (Stage 1)
CMD ["npm", "run", "dev"]
