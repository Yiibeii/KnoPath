from sqlalchemy import Column, String, Integer, Boolean, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from database import Base
import uuid


def generate_uuid():
    return str(uuid.uuid4())


def utcnow():
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=generate_uuid)
    title = Column(String, nullable=False)
    node_count = Column(Integer, default=0)
    is_favorite = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    nodes = relationship("Node", back_populates="project", cascade="all, delete-orphan")
    edges = relationship("Edge", back_populates="project", cascade="all, delete-orphan")


class Node(Base):
    __tablename__ = "nodes"

    id = Column(String, primary_key=True, default=generate_uuid)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    parent_id = Column(String, ForeignKey("nodes.id", ondelete="SET NULL"), nullable=True)
    node_type = Column(String, default="root")
    question = Column(Text, nullable=True)
    answer = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    context = Column(Text, nullable=True)
    is_marked = Column(Boolean, default=False)
    is_branch_collapsed = Column(Boolean, default=False)
    is_node_collapsed = Column(Boolean, default=False)
    children_count = Column(Integer, default=0)
    position_x = Column(Integer, default=96)
    position_y = Column(Integer, default=120)
    width = Column(Integer, default=290)
    height = Column(Integer, default=380)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    insight_updated_at = Column(DateTime, nullable=True)
    exploration = Column(JSON, nullable=True)

    project = relationship("Project", back_populates="nodes")
    children = relationship("Node", backref="parent_node", remote_side=[id])


class Edge(Base):
    __tablename__ = "edges"

    id = Column(String, primary_key=True, default=generate_uuid)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    source = Column(String, nullable=False)
    target = Column(String, nullable=False)

    project = relationship("Project", back_populates="edges")


class WikiPage(Base):
    __tablename__ = "wiki_pages"

    id = Column(String, primary_key=True, default=generate_uuid)
    title = Column(String, nullable=False)
    canonical_title = Column(String, nullable=True, index=True)
    content = Column(Text, nullable=True)
    status = Column(String, default="draft")
    sensitivity = Column(String, default="internal")
    summary = Column(Text, nullable=True)
    source_references = Column(Text, nullable=True)
    related_topics = Column(Text, nullable=True)
    questions = Column(Text, nullable=True)
    source_node_id = Column(String, ForeignKey("nodes.id", ondelete="SET NULL"), nullable=True)
    source_project_id = Column(String, ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    tags = Column(Text, nullable=True)
    pending_links = Column(Text, nullable=True)  # JSON: [{source_node_id, target_title, link_type}]
    compiled_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    source_node = relationship("Node", foreign_keys=[source_node_id])
    source_project = relationship("Project", foreign_keys=[source_project_id])
    outgoing_links = relationship("WikiLink", foreign_keys="WikiLink.source_page_id", cascade="all, delete-orphan")
    incoming_links = relationship("WikiLink", foreign_keys="WikiLink.target_page_id", cascade="all, delete-orphan")
    source_nodes = relationship("WikiPageSource", back_populates="page", cascade="all, delete-orphan")


class WikiPageSource(Base):
    __tablename__ = "wiki_page_sources"

    id = Column(String, primary_key=True, default=generate_uuid)
    page_id = Column(String, ForeignKey("wiki_pages.id", ondelete="CASCADE"), nullable=False)
    node_id = Column(String, ForeignKey("nodes.id", ondelete="SET NULL"), nullable=True)
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)

    page = relationship("WikiPage", back_populates="source_nodes")
    node = relationship("Node", foreign_keys=[node_id])
    project = relationship("Project", foreign_keys=[project_id])


class WikiLink(Base):
    __tablename__ = "wiki_links"

    id = Column(String, primary_key=True, default=generate_uuid)
    source_page_id = Column(String, ForeignKey("wiki_pages.id", ondelete="CASCADE"), nullable=False)
    target_page_id = Column(String, ForeignKey("wiki_pages.id", ondelete="CASCADE"), nullable=False)
    link_type = Column(String, default="reference")
    context = Column(Text, nullable=True)

    source_page = relationship("WikiPage", foreign_keys=[source_page_id], overlaps="outgoing_links")
    target_page = relationship("WikiPage", foreign_keys=[target_page_id], overlaps="incoming_links")
