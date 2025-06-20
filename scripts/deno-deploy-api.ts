export interface DenoDeployment {
  id: string;
  url: string;
  domains: string[];
  envVars: Record<string, string>;
  status: "success" | "failed" | "pending";
  createdAt: string;
  updatedAt: string;
  description?: string;
  branch?: string;
  isProductionDeployment: boolean;
}

export interface DenoDeployProject {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  productionDeployment: DenoDeployment | null;
  hasProductionDeployment: boolean;
  gitRepository: {
    id: string;
    owner: string;
    name: string;
  } | null;
}

export interface DenoDeploymentsResponse {
  deployments: DenoDeployment[];
  hasMore: boolean;
  page: number;
  total: number;
}

export class DenoDeployApi {
  private token: string;
  private projectName: string;
  private baseUrl = "https://api.deno.com/v1";

  constructor(token?: string, projectName?: string) {
    this.token = token || Deno.env.get("DENO_DEPLOY_TOKEN") || "";
    this.projectName = projectName || Deno.env.get("DENO_PROJECT_NAME") || "telegram-interface";
    
    if (!this.token) {
      throw new Error("DENO_DEPLOY_TOKEN environment variable is required");
    }
  }

  private async request<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Deno Deploy API error (${response.status}): ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to fetch from Deno Deploy API: ${error.message}`);
      }
      throw error;
    }
  }

  async getProject(): Promise<DenoDeployProject> {
    return await this.request<DenoDeployProject>(`/projects/${this.projectName}`);
  }

  async getDeployments(page = 1, limit = 20): Promise<DenoDeploymentsResponse> {
    return await this.request<DenoDeploymentsResponse>(
      `/projects/${this.projectName}/deployments?page=${page}&limit=${limit}`
    );
  }

  async getLatestNonMainDeploymentUrl(): Promise<string | null> {
    try {
      const deploymentsResponse = await this.getDeployments(1, 50);
      
      // Filter for successful, non-production deployments
      const previewDeployments = deploymentsResponse.deployments.filter(
        deployment => 
          deployment.status === "success" && 
          !deployment.isProductionDeployment &&
          deployment.url
      );

      if (previewDeployments.length === 0) {
        return null;
      }

      // Return the most recent preview deployment URL
      return previewDeployments[0].url;
    } catch (error) {
      console.error("Error fetching latest non-main deployment:", error);
      return null;
    }
  }

  async getProductionDeploymentUrl(): Promise<string> {
    return `https://${this.projectName}.deno.dev`;
  }

  async getAllDeploymentUrls(): Promise<{ production: string; preview: string | null }> {
    const [production, preview] = await Promise.all([
      this.getProductionDeploymentUrl(),
      this.getLatestNonMainDeploymentUrl(),
    ]);

    return { production, preview };
  }
}

export async function getDeploymentUrl(botType: "production" | "preview"): Promise<string> {
  const api = new DenoDeployApi();
  
  if (botType === "production") {
    return await api.getProductionDeploymentUrl();
  } else {
    const previewUrl = await api.getLatestNonMainDeploymentUrl();
    if (!previewUrl) {
      throw new Error("No preview deployment found. Deploy a branch to get a preview URL.");
    }
    return previewUrl;
  }
}