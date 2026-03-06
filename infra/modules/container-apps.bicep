@description('Name of the Container App')
param name string

@description('Location for the resource')
param location string

param tags object = {}
param containerRegistryName string
param environmentName string
param image string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@secure()
param azureClientId string
@secure()
param azureTenantId string
@secure()
param azureClientSecret string
@secure()
param githubClientId string
@secure()
param sessionSecret string

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: containerRegistryName
}

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  properties: {
    environmentId: containerAppsEnvironment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: containerRegistry.properties.loginServer
          username: containerRegistry.listCredentials().username
          passwordSecretRef: 'registry-password'
        }
      ]
      secrets: [
        {
          name: 'registry-password'
          value: containerRegistry.listCredentials().passwords[0].value
        }
        { name: 'azure-client-id', value: azureClientId }
        { name: 'azure-tenant-id', value: azureTenantId }
        { name: 'azure-client-secret', value: azureClientSecret }
        { name: 'github-client-id', value: githubClientId }
        { name: 'session-secret', value: sessionSecret }
      ]
    }
    template: {
      containers: [
        {
          name: 'copilot-cli-web'
          image: image
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3000' }
            { name: 'AZURE_CLIENT_ID', secretRef: 'azure-client-id' }
            { name: 'AZURE_TENANT_ID', secretRef: 'azure-tenant-id' }
            { name: 'AZURE_CLIENT_SECRET', secretRef: 'azure-client-secret' }
            { name: 'GITHUB_CLIENT_ID', secretRef: 'github-client-id' }
            { name: 'SESSION_SECRET', secretRef: 'session-secret' }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [
          {
            name: 'http-rule'
            http: {
              metadata: {
                concurrentRequests: '10'
              }
            }
          }
        ]
      }
    }
  }
}

output fqdn string = containerApp.properties.configuration.ingress.fqdn
