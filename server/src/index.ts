import app from "./app";
import { env } from "./config/env";

app.listen(env.PORT, () => {
  console.log(`Admin API executando em http://localhost:${env.PORT}`);
});
