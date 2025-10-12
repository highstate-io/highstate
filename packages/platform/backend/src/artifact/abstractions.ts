export interface ArtifactBackend {
  /**
   * Stores content in the backend.
   * If content with the same id already exists, does nothing.
   *
   * @param projectId The project ID to which the content belongs.
   * @param artifactId The ID of the artifact to store.
   * @param chunkSize The size of each chunk to store. Only the last chunk may be smaller.
   * @param content The async iterable of content chunks.
   */
  store(
    projectId: string,
    artifactId: string,
    chunkSize: number,
    content: AsyncIterable<Uint8Array>,
  ): Promise<void>

  /**
   * Retrieves content by artifact ID.
   *
   * @param projectId The project ID to which the content belongs.
   * @param artifactId The ID of the artifact to retrieve.
   * @param chunkSize The size of each chunk to retrieve. Only the last chunk may be smaller.
   */
  retrieve(
    projectId: string,
    artifactId: string,
    chunkSize: number,
  ): Promise<AsyncIterable<Uint8Array> | null>

  /**
   * Deletes content by artifact ID.
   *
   * @param projectId The project ID to which the content belongs.
   * @param artifactId The ID of the artifact to delete.
   */
  delete(projectId: string, artifactId: string): Promise<void>

  /**
   * Checks if content exists by artifact ID.
   *
   * @param projectId The project ID to which the content belongs.
   * @param artifactId The ID of the artifact to check.
   */
  exists(projectId: string, artifactId: string): Promise<boolean>
}
