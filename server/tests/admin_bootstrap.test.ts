import "./setup-env";

import { buildBootstrapUserSeed } from "../src/modules/auth/admin-user-store-postgres";
import { verifyPassword } from "../src/utils/crypto";

describe("admin bootstrap hashing", () => {
  test("hashes ADMIN_USERS_JSON passwords before persistence", () => {
    const seed = buildBootstrapUserSeed({
      email: "owner@example.com",
      displayName: "Owner",
      password: "ChangeMe123!",
      role: "ceo",
      botIds: [],
      isActive: true,
    });

    expect(seed.passwordHash).not.toBe("ChangeMe123!");
    expect(seed.passwordHash).toMatch(/^scrypt\$/);
    expect(seed.passwordHash).not.toContain("ChangeMe123!");
    expect(verifyPassword("ChangeMe123!", seed.passwordHash)).toBe(true);
  });
});
