import type { ReactNode } from "react";
import Layout from "@theme/Layout";

import { R1Simulation } from "../components/R1Simulation";

export default function Simulation(): ReactNode {
  return (
    <Layout
      title="Simulation"
      description="Browser-based MuJoCo simulation workspace for R1">
      <R1Simulation />
    </Layout>
  );
}
