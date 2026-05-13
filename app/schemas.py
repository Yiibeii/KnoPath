from pydantic import BaseModel
from typing import Optional, List, Dict, Union
from datetime import datetime


class ModelConfig(BaseModel):
    model: str = "gpt-4o"
    baseUrl: str = "https://api.openai.com/v1"
    temperature: float = 0.7
    systemPrompt: str = ""


class KnowledgeBaseTemplates(BaseModel):
    readme: str = ""
    claude: str = ""
    index: str = ""


class KnowledgeBaseConfig(BaseModel):
    directoryName: str = ""
    directoryPath: str = ""
    autoInit: bool = True
    lastValidated: Optional[str] = None
    pickedDirectory: Optional[str] = None
    templates: KnowledgeBaseTemplates = KnowledgeBaseTemplates()


class GlobalSettings(BaseModel):
    model: ModelConfig = ModelConfig()
    knowledgeBase: KnowledgeBaseConfig = KnowledgeBaseConfig()


class GlobalSettingsUpdate(BaseModel):
    model: Optional[ModelConfig] = None
    knowledgeBase: Optional[KnowledgeBaseConfig] = None


class ExplorationData(BaseModel):
    deep: List[str] = []
    lateral: List[str] = []
    applied: List[str] = []


class NodeDataBase(BaseModel):
    parentId: Optional[str] = None
    type: str = "root"
    question: Optional[str] = None
    answer: Optional[str] = None
    summary: Optional[str] = None
    context: Optional[str] = None
    isMarked: bool = False
    isBranchCollapsed: bool = False
    isNodeCollapsed: bool = False
    childrenCount: int = 0
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None
    insightUpdatedAt: Optional[str] = None
    exploration: Optional[ExplorationData] = None


class NodeBase(BaseModel):
    id: str
    type: str = "knopath"
    position: dict
    width: int = 290
    height: int = 380
    data: NodeDataBase


class EdgeBase(BaseModel):
    id: str
    source: str
    target: str


class ProjectBase(BaseModel):
    id: str
    title: str
    nodes: List[NodeBase] = []
    edges: List[EdgeBase] = []
    nodeCount: int = 0
    isFavorite: bool = False
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


class ProjectCreate(BaseModel):
    title: str = "Untitled Project"


class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    isFavorite: Optional[bool] = None


class NodeCreate(BaseModel):
    parentId: Optional[str] = None
    question: Optional[str] = None


class NodeUpdate(BaseModel):
    question: Optional[str] = None
    answer: Optional[str] = None
    summary: Optional[str] = None
    context: Optional[str] = None
    isMarked: Optional[bool] = None
    isBranchCollapsed: Optional[bool] = None
    isNodeCollapsed: Optional[bool] = None


class SaveRequest(BaseModel):
    project: ProjectBase


class RepositorySettingsUpdate(BaseModel):
    repositoryRoot: str


class RepositorySettingsResponse(BaseModel):
    repositoryRoot: str
    rawPath: str
    wikiPath: str
    knopathPath: str
    databasePath: str


class FileContent(BaseModel):
    path: str
    content: str


class ProjectFilesResponse(BaseModel):
    projectId: str
    projectTitle: str
    files: List[FileContent]


class WikiPageBase(BaseModel):
    id: str
    title: str
    canonicalTitle: Optional[str] = None
    content: Optional[str] = None
    status: str = "draft"
    sensitivity: str = "internal"
    summary: Optional[str] = None
    sourceReferences: List[str] = []
    relatedTopics: List[str] = []
    questions: List[str] = []
    sourceNodeId: Optional[str] = None
    sourceNodeIds: List[str] = []
    sourceProjectId: Optional[str] = None
    tags: List[str] = []
    compiledAt: Optional[str] = None
    updatedAt: Optional[str] = None


class WikiLinkBase(BaseModel):
    id: str
    sourcePageId: str
    targetPageId: str
    linkType: str = "reference"
    context: Optional[str] = None


class WikiGraphData(BaseModel):
    pages: List[WikiPageBase]
    links: List[WikiLinkBase]


class WikiCompileRequest(BaseModel):
    projectId: str
    nodeIds: List[str] = []
    modelConfig: Optional[dict] = None


class WikiSyncRequest(BaseModel):
    projectId: str
    modelConfig: dict = {}


class ImportJsonRequest(BaseModel):
    title: str
    jsonData: Union[List[dict], dict]
