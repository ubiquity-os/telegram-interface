declare namespace Deno {
  export const env: {
    get(key: string): string | undefined;
  };
  export const mainModule: string;
}

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

      return await response.json() as T;
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
    const response = await this.request<any>(
      `/projects/${this.projectName}/deployments?page=${page}&limit=${limit}`
    );
    
    // Handle different response formats
    if (Array.isArray(response)) {
      // New format: array of deployments
      return {
        deployments: response,
        hasMore: false,
        page: 1,
        total: response.length
      };
    } else if (response.deployments) {
      // Old format: object with deployments property
      return response as DenoDeploymentsResponse;
    } else {
      throw new Error("Unexpected response format from Deno Deploy API");
    }
  }

  async getLatestDeploymentUrl(isProduction: boolean): Promise<string> {
    try {
      const deploymentsResponse = await this.getDeployments(1, 50);
      
      // Filter for successful deployments
      const validDeployments = deploymentsResponse.deployments.filter(
        deployment => 
          deployment.status === "success" && 
          deployment.url
      );

      // If no deployments found but we have a project name, use the standard URL
      if (validDeployments.length === 0) {
        return `https://${this.projectName}.deno.dev`;
      }

      // Find production deployment if requested
      if (isProduction) {
        const productionDeployment = validDeployments.find(
          d => d.isProductionDeployment
        );
        if (productionDeployment) {
          return productionDeployment.url;
        }
        return `https://${this.projectName}.deno.dev`;
      }

      // For preview, find the latest non-production deployment
      const previewDeployments = validDeployments.filter(
        d => !d.isProductionDeployment
      );

      if (previewDeployments.length === 0) {
        throw new Error("No preview deployments found");
      }

      // Sort deployments by createdAt date (newest first)
      previewDeployments.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  
      // Return the most recent preview deployment URL
      return previewDeployments[0].url;
    } catch (error) {
      console.error("Error fetching deployment URL:", error);
      throw error;
    }
  }
}

export async function getDeploymentUrl(isProduction: boolean): Promise<string> {
  const api = new DenoDeployApi();
  return await api.getLatestDeploymentUrl(isProduction);
}

// Temporary debug function
async function debugProject() {
  try {
    const api = new DenoDeployApi();
    const project = await api.getProject();
    console.log("Project Details:", project);
    const deployments = await api.getDeployments();
    console.log("Latest Deployments:", deployments);
  } catch (error) {
    console.error("Debug Error:", error);
  }
}

if (import.meta.url === Deno.mainModule) {
  debugProject();
}
