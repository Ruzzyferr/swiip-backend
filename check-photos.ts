import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

console.log("DATABASE_URL:", process.env.DATABASE_URL ? "Defined" : "Undefined");

const prisma = new PrismaClient();

async function main() {
    const profile = await prisma.profile.findFirst({
        where: { displayName: "John" },
    });
    console.log("Photos for John:", profile?.photos);
}

main()
    .catch((e) => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
