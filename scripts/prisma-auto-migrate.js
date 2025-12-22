import { execSync } from "child_process";

const date = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);

const name = `auto_${date}`;

console.log(`🚀 Running migration: ${name}`);

execSync(`npx prisma migrate dev --name ${name}`, {
    stdio: "inherit",
});
